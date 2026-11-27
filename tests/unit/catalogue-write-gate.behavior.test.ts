import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

/**
 * CATALOGUE-GATE-1127 (security hotfix 2026-11-27): on 2026-11-20 a self-signed-up org created the fleet-wide
 * tactic `x` with its own user key (1,407 Jev verdicts on our spend) and swept every catalogue write. A CUSTOMER
 * key now gets 403 `staff_only` on every tactic/strategy/play write; a staff key still writes. Sales funnels and
 * sales paths stay customer-creatable (owner 2026-10-16; idempotent, `runnableOnly`, no edit route, no judging).
 * The REAL `requireStaffActor` runs; only `authenticateUser` is stubbed to stand in for each key.
 */
const identity = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  return {
    ...actual,
    authenticateUser: (req: any, _res: any, next: any) => {
      Object.assign(req, { userId: "user-1", orgId: "org-1", runId: "run-1" }, identity.current);
      next();
    },
  };
});

import playsRouter from "../../src/routes/plays.js";
import catalogueRouter from "../../src/routes/catalogue-staff.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(playsRouter);
  a.use(catalogueRouter);
  return a;
}

const STAFF_KEY = { authType: "user_key", userKeyScope: { isStaff: true, email: "kevin@distribute.you", memberships: [] } };
const CLIENT_KEY = { authType: "user_key", userKeyScope: { isStaff: false, email: "attacker@example.com", memberships: [] } };
// A client key carrying a staff-looking stored email but not a pinned staff user: still a client.
const FORGED_KEY = { authType: "user_key", userKeyScope: { isStaff: false, email: "kevin@distribute.you", memberships: [] } };

const WRITES: Array<{ method: "post" | "patch"; path: string; downstream: string; author: "createdBy" | "updatedBy" }> = [
  { method: "post", path: "/v1/tactics", downstream: "/internal/catalogue/tactics", author: "createdBy" },
  { method: "patch", path: "/v1/tactics/x", downstream: "/internal/catalogue/tactics/x", author: "updatedBy" },
  { method: "post", path: "/v1/strategies", downstream: "/internal/catalogue/strategies", author: "createdBy" },
  { method: "patch", path: "/v1/strategies/x", downstream: "/internal/catalogue/strategies/x", author: "updatedBy" },
  { method: "post", path: "/v1/plays", downstream: "/internal/catalogue/plays", author: "createdBy" },
];

let calls: Array<{ url: string; init: any }>;
beforeEach(() => {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json" } });
  });
});

describe("catalogue writes refuse a customer key", () => {
  for (const w of WRITES) {
    it(`${w.method.toUpperCase()} ${w.path}: client key → 403 staff_only naming the staff-request door, features never called`, async () => {
      for (const key of [CLIENT_KEY, FORGED_KEY]) {
        identity.current = key;
        const res = await request(app())[w.method](w.path).set("x-email", "kevin@distribute.you").send({ name: "x", description: "x" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("staff_only");
        expect(res.body.message).toContain("POST /v1/staff-requests");
      }
      expect(calls).toHaveLength(0);
    });

    it(`${w.method.toUpperCase()} ${w.path}: platform key + a non-staff x-email → 403, features never called`, async () => {
      identity.current = { authType: "admin", userKeyScope: undefined };
      const res = await request(app())[w.method](w.path).set("x-email", "client@acme.com").send({ name: "x" });
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it(`${w.method.toUpperCase()} ${w.path}: staff key writes, ${w.author} = the staff email (sent value overwritten)`, async () => {
      identity.current = STAFF_KEY;
      const res = await request(app())[w.method](w.path).send({ name: "x", [w.author]: "forged" });
      expect(res.status).toBe(201);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${FEATURES_BASE}${w.downstream}`);
      expect(JSON.parse(calls[0].init.body)[w.author]).toBe("kevin@distribute.you");
    });

    it(`${w.method.toUpperCase()} ${w.path}: platform key + staff x-email writes`, async () => {
      identity.current = { authType: "admin", userKeyScope: undefined };
      const res = await request(app())[w.method](w.path).set("x-email", "kevin@distribute.you").send({ name: "x" });
      expect(res.status).toBe(201);
      expect(JSON.parse(calls[0].init.body)[w.author]).toBe("kevin@distribute.you");
    });
  }
});

describe("reads stay open to a customer key", () => {
  for (const path of ["/v1/tactics", "/v1/tactics/x", "/v1/strategies", "/v1/plays?pipe=p"]) {
    it(`GET ${path} answers a client key`, async () => {
      identity.current = CLIENT_KEY;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        calls.push({ url, init: {} });
        return new Response('{"rows":[]}', { status: 200, headers: { "content-type": "application/json" } });
      });
      const res = await request(app()).get(path);
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
    });
  }
});

describe("sales funnels and sales paths stay customer-creatable (owner 2026-10-16), runnable only", () => {
  for (const object of ["sales-funnels", "sales-paths"]) {
    it(`POST /v1/catalogue/${object}: client key passes with runnableOnly: true and its own identity as author`, async () => {
      identity.current = CLIENT_KEY;
      const res = await request(app()).post(`/v1/catalogue/${object}`).send({ legKeys: ["a"], createdBy: "forged" });
      expect(res.status).toBe(201);
      const body = JSON.parse(calls[0].init.body);
      expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/${object}`);
      expect(body.runnableOnly).toBe(true);
      expect(body.createdBy).toBe("attacker@example.com");
      expect(body.requestedByOrgId).toBe("org-1");
    });
  }
});
