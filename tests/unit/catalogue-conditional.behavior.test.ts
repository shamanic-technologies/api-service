import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * The per-key catalogue (`GET /v1/me/openapi.json`) answers conditional
 * requests: ETag on 200, 304 with no body when `If-None-Match` names it, even
 * when the request also carries `Cache-Control: no-cache` (Node's fetch adds
 * it to every conditional request, which made Express's own check refuse 304).
 * And a catalogue read made with a client's key is never filed on their
 * Unibox thread, while a real call right after still is.
 */

process.env.CRM_SERVICE_URL = "http://crm.test";
process.env.CRM_SERVICE_API_KEY = "test-crm-key";

const USER_KEY = "distrib.usr_abcdefghijklmnopqrstuvwxyz0123456789";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.userId = "22222222-2222-4222-8222-222222222222";
    req.orgId = "11111111-1111-4111-8111-111111111111";
    req.runId = "run-1";
    req.authType = "user_key";
    req.userKeyScope = { isStaff: false, memberships: [], email: "client@acme.com", displayName: "Ada" };
    next();
  },
  AuthenticatedRequest: {},
}));

import meRouter from "../../src/routes/me.js";
import { _queuedCalls, _resetCallLog, isHousekeepingCall, recordCustomerCalls } from "../../src/lib/call-log.js";
import { etagMatches } from "../../src/lib/catalogue-response.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(recordCustomerCalls);
  app.use("/v1", meRouter);
  app.get("/v1/brands", (req: any, res) => {
    req.userId = "22222222-2222-4222-8222-222222222222";
    req.orgId = "11111111-1111-4111-8111-111111111111";
    req.authType = "user_key";
    res.json({ brands: [] });
  });
  return app;
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const auth = { Authorization: `Bearer ${USER_KEY}` };

beforeEach(() => _resetCallLog());

describe("GET /v1/me/openapi.json conditional requests", () => {
  it("200 carries an ETag; If-None-Match on it answers 304 with no body", async () => {
    const app = buildApp();
    const first = await request(app).get("/v1/me/openapi.json").set(auth);
    expect(first.status).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toMatch(/^W\/".+"$/);
    expect(first.body.openapi).toBeDefined();
    expect(Number(first.headers["content-length"])).toBeGreaterThan(1000);

    const again = await request(app).get("/v1/me/openapi.json").set(auth).set("If-None-Match", etag).set("Cache-Control", "no-cache");
    expect(again.status).toBe(304);
    expect(again.text ?? "").toBe("");
    expect(again.headers.etag).toBe(etag);
  });

  it("a stale or foreign tag gets the full document", async () => {
    const res = await request(buildApp()).get("/v1/me/openapi.json").set(auth).set("If-None-Match", 'W/"stale"');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBeDefined();
  });

  it("HEAD returns the same ETag with no body", async () => {
    const app = buildApp();
    const get = await request(app).get("/v1/me/openapi.json").set(auth);
    const head = await request(app).head("/v1/me/openapi.json").set(auth);
    expect(head.status).toBe(200);
    expect(head.headers.etag).toBe(get.headers.etag);
  });

  it("weak comparison: the strong form, a list and * all match", () => {
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true);
    expect(etagMatches('W/"x", W/"abc"', 'W/"abc"')).toBe(true);
    expect(etagMatches("*", 'W/"abc"')).toBe(true);
    expect(etagMatches('W/"abd"', 'W/"abc"')).toBe(false);
    expect(etagMatches(undefined, 'W/"abc"')).toBe(false);
  });
});

describe("catalogue reads are not conversation items", () => {
  it("GET, 304 and HEAD on the catalogue record nothing; a real call right after is recorded", async () => {
    const app = buildApp();
    const first = await request(app).get("/v1/me/openapi.json").set(auth).set("x-distribute-client", "mcp");
    await request(app).get("/v1/me/openapi.json").set(auth).set("If-None-Match", first.headers.etag);
    await request(app).head("/v1/me/openapi.json").set(auth);
    await settle();
    expect(_queuedCalls()).toHaveLength(0);

    await request(app).get("/v1/brands").set(auth);
    await settle();
    expect(_queuedCalls().map((c) => c.path)).toEqual(["/v1/brands"]);
  });

  it("names every catalogue document, GET/HEAD only", () => {
    for (const p of ["/openapi.json", "/public/openapi.json", "/internal/openapi.json", "/v1/me/openapi.json", "/v1/me/openapi.json?x=1", "/v1/me/openapi.json/"]) {
      expect(isHousekeepingCall("GET", p)).toBe(true);
      expect(isHousekeepingCall("HEAD", p)).toBe(true);
    }
    expect(isHousekeepingCall("POST", "/v1/me/openapi.json")).toBe(false);
    expect(isHousekeepingCall("GET", "/v1/me")).toBe(false);
    expect(isHousekeepingCall("GET", "/v1/brands")).toBe(false);
  });
});
