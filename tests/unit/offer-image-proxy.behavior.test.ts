import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BRAND_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { BRAND_BASE };
});

/**
 * POST /v1/brands/:id/offers/:offerId/image — BEHAVIOURAL cover.
 *
 * The customer presses "Regenerate with AI" on Offer Settings and the dashboard talks to
 * nothing but this gateway. A source-substring test cannot see a template literal's
 * interpolated value, so it can verify neither the downstream path nor the identity
 * carried with it (CLAUDE.md #7 corollary 3). This drives the real router with supertest
 * and a stubbed fetch.
 *
 * What the button depends on, asserted here:
 *  - the write reaches brand-service's OWN path, /orgs/brands/{id}/offers/{offerId}/image;
 *  - the identity headers arrive — chat-service bills the requesting org for the image, so
 *    an identity that does not arrive is a spend attributed to nobody;
 *  - the org reaching brand-service is the AUTHENTICATED one, never a caller override;
 *  - the body passes through unchanged, including a field this gateway has never heard of
 *    (the request is a passthrough, not a whitelist — CLAUDE.md #8 corollary);
 *  - the producer's body comes back unchanged, imageUrl included;
 *  - and the 402 — the org cannot afford it — reaches the caller AS a 402 with its body.
 *    The dashboard's billing guard keys on that exact status to open its recharge modal;
 *    a 402 flattened into a 500 breaks the one affordance that resolves the refusal.
 *
 * Per CLAUDE.md #6/#8 the payloads are fixtures, not a contract this repo owns.
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "0d3d1f2c-8f4a-4a2e-9d1b-2f0f6a7c5b31";

const OFFER_BODY = {
  offer: {
    offerId: OFFER_ID,
    brandId: BRAND_ID,
    name: "Growth plan",
    imageUrl: "https://images.distribute.you/offers/0d3d1f2c.png",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-09T09:30:00.000Z",
  },
};

describe("POST /v1/brands/:id/offers/:offerId/image — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stubUpstream(body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(body) };
    });
  }

  function stubUpstreamError(status: number, body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve({}),
      };
    });
  }

  beforeEach(() => {
    calls = [];
  });

  it("forwards to brand-service's offer-image path, carrying the resolved identity", async () => {
    stubUpstream(OFFER_BODY);

    const res = await request(buildApp())
      .post(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/image`)
      .send({});

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/image`);
    expect(calls[0].options.method).toBe("POST");
    // chat-service bills the requesting org for the image — an identity that does not
    // arrive is a spend attributed to nobody.
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("brand-test-key");
  });

  it("returns brand-service's body unchanged, imageUrl included", async () => {
    stubUpstream(OFFER_BODY);

    const res = await request(buildApp())
      .post(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/image`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(OFFER_BODY);
  });

  it("forwards the body verbatim — a prompt, and a field the gateway has never heard of", async () => {
    stubUpstream(OFFER_BODY);

    await request(buildApp())
      .post(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/image`)
      .send({ prompt: "A brass compass on a folded map", somethingBrandShipsNext: 42 });

    expect(JSON.parse(calls[0].options.body)).toEqual({
      prompt: "A brass compass on a folded map",
      somethingBrandShipsNext: 42,
    });
  });

  it("ignores a caller-supplied org — only the authenticated org reaches brand-service", async () => {
    stubUpstream(OFFER_BODY);

    const res = await request(buildApp())
      .post(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/image`)
      .set("x-org-id", "someone-elses-org")
      .send({});

    expect(res.status).toBe(200);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("propagates the 402 AS a 402 with its body — the dashboard's recharge modal keys on it", async () => {
    stubUpstreamError(402, { error: "Insufficient credits" });

    const res = await request(buildApp())
      .post(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/image`)
      .send({});

    expect(res.status).toBe(402);
    expect(res.body).toEqual({ error: "Insufficient credits" });
  });

  for (const [status, body] of [
    [400, { error: "Invalid offer ID format", code: "BAD_REQUEST" }],
    [403, { error: "Brand does not belong to the caller's org", code: "FORBIDDEN" }],
    [404, { error: "No such offer on this brand", code: "OFFER_NOT_FOUND" }],
    [502, { error: "Image generation failed", code: "IMAGE_GENERATION_FAILED" }],
  ] as const) {
    it(`propagates an upstream ${status} with its body intact rather than a generic 500`, async () => {
      stubUpstreamError(status, body);

      const res = await request(buildApp())
        .post(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/image`)
        .send({});

      // Not flattened into { error: "<the whole JSON body>" } — `code` survives the hop
      // so a consumer can branch on the reason (CLAUDE.md #7).
      expect(res.status).toBe(status);
      expect(res.body).toEqual(body);
    });
  }

  it("leaves the sibling offer routes reaching their own downstream paths", async () => {
    stubUpstream({ offer: { offerId: OFFER_ID } });

    await request(buildApp()).get(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}`);
    await request(buildApp()).get(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/user-fields`);
    await request(buildApp()).patch(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}`).send({ name: "x" });

    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}`);
    expect(calls[1].url).toBe(
      `${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/user-fields`,
    );
    expect(calls[2].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}`);
    expect(calls[2].options.method).toBe("PATCH");
  });
});
