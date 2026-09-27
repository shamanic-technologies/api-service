import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the router imports.
const { HUMAN_BASE, BRAND_BASE } = vi.hoisted(() => {
  const HUMAN_BASE = "http://human.test.local";
  const BRAND_BASE = "http://brand.test.local";
  process.env.HUMAN_SERVICE_URL = HUMAN_BASE;
  process.env.HUMAN_SERVICE_API_KEY = "human-test-key";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { HUMAN_BASE, BRAND_BASE };
});

/**
 * The four routes the dashboard's "New organization" modal needs, driven over the
 * wire (CLAUDE.md #7 corollaries 2/3):
 *   POST /v1/orgs/audiences/split           → human-service POST /orgs/audiences/split
 *   POST /v1/orgs/audiences/split/confirm   → human-service POST /orgs/audiences/split/confirm
 *   POST /v1/brands/:id/offers/proposals    → brand-service POST /orgs/brands/{id}/offers/proposals
 *   POST /v1/brands/:id/offers/confirm      → brand-service POST /orgs/brands/{id}/offers/confirm
 * Asserted: the full downstream URL, the authenticated identity, the byte-identical body
 * both ways, and the downstream status + body forwarded field for field (201, 409, 422, 502).
 * Payloads are fixtures, not a contract this repo owns (#6/#8).
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
import audiencesRouter from "../../src/routes/audiences.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  app.use("/v1", audiencesRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";

let calls: Array<{ url: string; options: any }>;

function stubUpstream(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    const ok = status >= 200 && status < 300;
    return {
      ok,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  });
}

beforeEach(() => {
  calls = [];
});

const CASES = [
  {
    gateway: "/v1/orgs/audiences/split",
    downstream: `${HUMAN_BASE}/orgs/audiences/split`,
    body: { brandId: BRAND_ID, targetAudience: "Dentists in France", futureField: 1 },
  },
  {
    gateway: "/v1/orgs/audiences/split/confirm",
    downstream: `${HUMAN_BASE}/orgs/audiences/split/confirm`,
    body: { brandId: BRAND_ID, offerId: "offer-a", segments: [{ name: "Paris", description: "x" }] },
  },
  {
    gateway: `/v1/brands/${BRAND_ID}/offers/proposals`,
    downstream: `${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/proposals`,
    body: { description: "We sell dental chairs", futureField: true },
  },
  {
    gateway: `/v1/brands/${BRAND_ID}/offers/confirm`,
    downstream: `${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/confirm`,
    body: { offers: [{ name: "Chair", description: "A chair" }] },
  },
] as const;

describe.each(CASES)("POST $gateway", ({ gateway, downstream, body }) => {
  it("forwards to the exact downstream path with the authenticated identity and the body untouched", async () => {
    const upstream = { anything: [1, 2], nested: { a: null } };
    stubUpstream(201, upstream);

    const res = await request(buildApp())
      .post(gateway)
      .set("x-org-id", "attacker-org")
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(downstream);
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it.each([
    [409, { error: "An audience named Paris already exists", code: "NAME_CONFLICT" }],
    [422, { error: "The description names nothing to sell" }],
    [502, { error: "LLM error", details: { provider: "gemini" } }],
  ])("forwards a downstream %i with its body field for field", async (status, errBody) => {
    stubUpstream(status, errBody);

    const res = await request(buildApp()).post(gateway).send(body);

    expect(res.status).toBe(status);
    expect(res.body).toEqual(errBody);
  });
});

describe("literal offer routes do not break the :offerId siblings", () => {
  it("POST /v1/brands/:id/offers/:offerId/image still reaches its own path", async () => {
    stubUpstream(200, { offer: {} });
    const res = await request(buildApp()).post(`/v1/brands/${BRAND_ID}/offers/offer-a/image`).send({});
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/offer-a/image`);
  });

});
