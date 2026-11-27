import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";

/**
 * SECRETS-ROTATE-1127. On 2026-11-20/21, 740 tables of every service database were read
 * through `/internal/admin/services/<svc>/tables/<table>/rows`: (a) a signed-in customer
 * through the dashboard proxy with `/api/v1/..%2f..%2finternal/admin/...` (the proxy injects
 * the platform key), (b) a script holding the leaked platform key. These tests drive the
 * REAL path guard, `authenticatePlatform` and `requireStaffHuman` (nothing mocked) and pin:
 * every traversal spelling 400 before any router; platform key + a customer session 403;
 * platform key with no human 403; a pinned staff human passes.
 */

import { refuseTraversalPaths, pathRefusalReason } from "../../src/middleware/path-guard.js";
import adminRoutes from "../../src/routes/admin.js";
import internalEmailsRoutes from "../../src/routes/internal-emails.js";
import platformKeysRoutes from "../../src/routes/platform-keys.js";

const PLATFORM_KEY = "secrets-rotate-platform-key";
const STAFF = { "x-email": "kevin@distribute.you", "x-external-user-id": "user_2yaCEpxeoOEIfXTdxTMY8pM8jXW" };
const CUSTOMER = { "x-email": "attacker@example.com", "x-external-user-id": "user_attacker", "x-external-org-id": "org_attacker" };

let routerHits: string[] = [];

function app() {
  const a = express();
  a.use(refuseTraversalPaths);
  a.use(express.json());
  a.use((req, _res, next) => {
    routerHits.push(req.originalUrl);
    next();
  });
  a.use("/internal", adminRoutes);
  a.use("/internal", internalEmailsRoutes);
  a.use("/platform-keys", platformKeysRoutes);
  a.use((_req, res) => res.status(404).json({ error: "not found" }));
  return a;
}

beforeAll(() => {
  process.env.ADMIN_DISTRIBUTE_API_KEY = PLATFORM_KEY;
});

beforeEach(() => {
  routerHits = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Sends the path BYTE FOR BYTE (supertest/WHATWG URL would normalise `..` and `.` client side,
 * which is exactly what a hostile client does not do).
 */
async function rawGet(path: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const server = app().listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

describe("path traversal is refused 400 before any router", () => {
  const variants = [
    "/v1/..%2finternal/admin/services",
    "/v1/..%2Finternal/admin/services",
    "/api/v1/..%2f..%2finternal/admin/services/google-service/tables/gmail_messages_raw/rows",
    "/v1/%2e%2e/internal/admin/services",
    "/v1/%2E%2E/internal/admin/services",
    "/v1/.%2e/internal/admin/services",
    "/v1/../internal/admin/services",
    "/v1/./internal/admin/services",
    "/v1/..%5cinternal/admin/services",
    "/v1/..%5Cinternal/admin/services",
    "/v1/..\\internal/admin/services",
    "/v1/..%252finternal/admin/services",
    "/v1/%252e%252e/internal/admin/services",
    "/v1/brands/..%2F..%2Finternal%2Fadmin",
    "/v1/%zz/x",
  ];
  for (const path of variants) {
    it(`${path} -> 400 invalid_path`, async () => {
      const res = await rawGet(path, { "x-api-key": PLATFORM_KEY, ...STAFF });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_path");
      expect(routerHits).toEqual([]);
    });
  }

  it("leaves ordinary paths and query strings alone", () => {
    expect(pathRefusalReason("/v1/campaigns/abc-123/stats")).toBeNull();
    expect(pathRefusalReason("/v1/users/by-email/a%40b.com")).toBeNull();
    expect(pathRefusalReason("/v1/engines/LinkedIn%20post%20published")).toBeNull();
    expect(pathRefusalReason("/v1/a.b/c..d")).toBeNull();
  });

  it("does not inspect the query string", async () => {
    const res = await request(app()).get("/internal/admin/services?next=..%2fx").set("x-api-key", PLATFORM_KEY).set(STAFF);
    expect(res.status).toBe(200);
  });
});

describe("/internal/admin/* requires a pinned staff human", () => {
  const routes: Array<["get" | "delete", string]> = [
    ["get", "/internal/admin/services"],
    ["get", "/internal/admin/services/google-service/tables"],
    ["get", "/internal/admin/services/google-service/tables/gmail_messages_raw/schema"],
    ["get", "/internal/admin/services/google-service/tables/gmail_messages_raw/rows"],
    ["delete", "/internal/admin/orgs/by-external/org_x"],
    ["delete", "/internal/admin/orgs/00000000-0000-4000-8000-000000000001"],
    ["get", "/INTERNAL/ADMIN/services"],
  ];

  for (const [method, path] of routes) {
    it(`${method.toUpperCase()} ${path}: no key -> 401`, async () => {
      const res = await request(app())[method](path).set(STAFF);
      expect(res.status).toBe(401);
    });

    it(`${method.toUpperCase()} ${path}: platform key + customer session -> 403`, async () => {
      const res = await request(app())[method](path).set("x-api-key", PLATFORM_KEY).set(CUSTOMER);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("staff_human_required");
    });

    it(`${method.toUpperCase()} ${path}: platform key, no human identity -> 403`, async () => {
      const res = await request(app())[method](path).set("x-api-key", PLATFORM_KEY);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("staff_human_required");
    });

    it(`${method.toUpperCase()} ${path}: staff email typed with a non-staff Clerk id -> 403`, async () => {
      const res = await request(app())[method](path)
        .set("x-api-key", PLATFORM_KEY)
        .set({ "x-email": "kevin@distribute.you", "x-external-user-id": "user_attacker" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("staff_human_required");
    });

    it(`${method.toUpperCase()} ${path}: staff Clerk id with the OTHER staff email -> 403`, async () => {
      const res = await request(app())[method](path)
        .set("x-api-key", PLATFORM_KEY)
        .set({ "x-email": "kevin.lourd@gmail.com", "x-external-user-id": "user_2yaCEpxeoOEIfXTdxTMY8pM8jXW" });
      expect(res.status).toBe(403);
    });

    it(`${method.toUpperCase()} ${path}: user key (Bearer) -> 401`, async () => {
      const res = await request(app())[method](path).set("authorization", "Bearer distrib.usr_x").set(STAFF);
      expect(res.status).toBe(401);
    });
  }

  it("a pinned staff human passes (GET /internal/admin/services)", async () => {
    const res = await request(app()).get("/internal/admin/services").set("x-api-key", PLATFORM_KEY).set(STAFF);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.services)).toBe(true);
  });

  it("the other pinned staff human passes too", async () => {
    const res = await request(app())
      .get("/internal/admin/services")
      .set("x-api-key", PLATFORM_KEY)
      .set({ "x-email": "Kevin.Lourd@gmail.com", "x-external-user-id": "user_3AI7TH7LLPltlSpF2UCTD5U1lLa" });
    expect(res.status).toBe(200);
  });

  it("the gate does not leak onto /internal/emails/templates (server-to-server, no identity)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const res = await request(app())
      .put("/internal/emails/templates")
      .set("x-api-key", PLATFORM_KEY)
      .send({ templates: [{ name: "welcome", subject: "s", htmlBody: "<p>x</p>" }] });
    expect(res.status).not.toBe(403);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("platform store writes refuse a browser-relayed identity", () => {
  it("POST /platform-keys with a customer session -> 403 server_to_server_only", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockClear();
    const res = await request(app())
      .post("/platform-keys")
      .set("x-api-key", PLATFORM_KEY)
      .set(CUSTOMER)
      .send({ provider: "anthropic", apiKey: "sk-evil" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("server_to_server_only");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
