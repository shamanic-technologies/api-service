import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * `POST /v1/share-tokens/resolve` — the org-less platform-auth route behind the
 * public share page.
 *
 * This file drives the REAL router with the REAL auth middleware. A
 * source-substring test cannot express what actually broke here: the route
 * carried `authenticate` (which reads correctly in the diff and passes any
 * "is the middleware present" check) while `authenticate`'s platform-key path
 * still resolves an identity, so it 400'd on every call for lack of an org. The
 * public page has no org by construction — resolving the credential is how it
 * learns which brand it is rendering — so every share link 500'd in production.
 *
 * The assertion that matters is therefore: a platform-keyed call carrying NO org
 * headers reaches brand-service.
 */

vi.hoisted(() => {
  process.env.BRAND_SERVICE_URL = "http://brand.test.local";
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

describe("POST /v1/share-tokens/resolve", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards an org-less platform-keyed call to brand-service", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ brandId: "b-1", brand: { id: "b-1", name: "Acme" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await request(buildApp())
      .post("/v1/share-tokens/resolve")
      .set("X-API-Key", "admin-test-key")
      .send({ shareToken: "bshr_abc" });

    // The regression: this was 400 "Organization context required".
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brandId: "b-1", brand: { id: "b-1", name: "Acme" } });
    expect(fetchMock).toHaveBeenCalled();

    // Full downstream path literal, not a prefix (CLAUDE.md corollary 2).
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/internal/share-tokens/resolve");

    // The credential goes in the BODY: in a URL it lands in access logs and
    // proxy traces, and it is exactly the secret that must not leak.
    expect(url).not.toContain("bshr_abc");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ shareToken: "bshr_abc" });
  });

  it("propagates brand-service's 404 for an unknown, revoked or rotated credential", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Share token not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const res = await request(buildApp())
      .post("/v1/share-tokens/resolve")
      .set("X-API-Key", "admin-test-key")
      .send({ shareToken: "bshr_gone" });

    // A 404 must stay a 404: the page renders its not-found state from it, and
    // anything else surfaces to a customer's reader as a broken link.
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/share-tokens/resolve — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    }) as unknown as typeof fetch;
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp())
      .post("/v1/share-tokens/resolve")
      .send({ shareToken: "bshr_abc" });
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a call carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .post("/v1/share-tokens/resolve")
      .set("X-API-Key", "not-the-admin-key")
      .send({ shareToken: "bshr_abc" });
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
