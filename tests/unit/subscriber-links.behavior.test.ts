import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/subscriber-links/:linkId — BEHAVIOURAL cover (real router, real
 * authenticatePlatform, stubbed fetch). The answer carries a subscriber's
 * email, so the properties that matter are on the wire: only the platform key
 * gets in, a request carrying a browser-proxy identity is refused before any
 * downstream call, nothing identifying goes downstream, and each producer
 * verdict (valid / tampered / unknown / revoked) keeps its status AND body.
 */

vi.hoisted(() => {
  process.env.TRANSACTIONAL_EMAIL_SERVICE_URL = "http://tes.test.local";
  process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY = "tes-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import subscriberLinksRouter from "../../src/routes/subscriber-links.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", subscriberLinksRouter);
  return app;
}

const fetchMock = vi.fn();
const realFetch = global.fetch;

function upstream(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = realFetch;
});

describe("GET /v1/subscriber-links/:linkId", () => {
  it.each([
    [200, { status: "valid", subscriber: { id: "s1", email: "staff@distribute.you", name: null }, listSlug: "newsletter" }],
    [400, { status: "tampered" }],
    [404, { status: "unknown" }],
    [410, { status: "revoked" }],
  ])("forwards the producer's %i verdict with its body, platform key only", async (status, body) => {
    upstream(status, body);
    const res = await request(buildApp())
      .get("/v1/subscriber-links/abc%2Fdef")
      .set("X-API-Key", "admin-test-key");

    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://tes.test.local/internal/subscriber-links/abc%2Fdef");
    const sent = init.headers as Record<string, string>;
    expect(sent["X-API-Key"]).toBe("tes-test-key");
    for (const h of ["x-org-id", "x-user-id", "x-run-id", "x-email"]) expect(sent[h]).toBeUndefined();
  });

  it("refuses a caller without the platform key (401, no downstream call)", async () => {
    const res = await request(buildApp()).get("/v1/subscriber-links/abc");
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a user key (Bearer) — 401, no downstream call", async () => {
    const res = await request(buildApp())
      .get("/v1/subscriber-links/abc")
      .set("Authorization", "Bearer distrib.usr_x");
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["x-external-org-id", "org_clerk"],
    ["x-external-user-id", "user_clerk"],
    ["x-org-id", "00000000-0000-4000-8000-000000000001"],
    ["x-email", "someone@example.com"],
    ["authorization", "Bearer distrib.usr_x"],
  ])("refuses the platform key when the request carries %s (browser-facing proxy) — 403", async (header, value) => {
    const res = await request(buildApp())
      .get("/v1/subscriber-links/abc")
      .set("X-API-Key", "admin-test-key")
      .set(header, value);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("server_to_server_only");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the exact header set the customer dashboard /api/v1 proxy sends", async () => {
    const res = await request(buildApp())
      .get("/v1/subscriber-links/abc")
      .set("X-API-Key", "admin-test-key")
      .set("x-external-org-id", "org_clerk")
      .set("x-external-user-id", "user_clerk")
      .set("x-email", "customer@example.com");
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
