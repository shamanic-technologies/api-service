import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load (content-generation eagerly,
// human lazily), so set them BEFORE the routers import.
const { HUMAN_BASE, CONTENT_BASE } = vi.hoisted(() => {
  const HUMAN_BASE = "http://human.test.local";
  const CONTENT_BASE = "http://content.test.local";
  process.env.HUMAN_SERVICE_URL = HUMAN_BASE;
  process.env.HUMAN_SERVICE_API_KEY = "human-test-key";
  process.env.CONTENT_GENERATION_SERVICE_URL = CONTENT_BASE;
  process.env.CONTENT_GENERATION_SERVICE_API_KEY = "content-test-key";
  return { HUMAN_BASE, CONTENT_BASE };
});

/**
 * The two reads the signed-out onboarding (/get-started) needs, driven through the
 * real routers with a stubbed fetch:
 *  - GET  /v1/orgs/audiences/:id/preview → human-service GET /orgs/audiences/{id}/preview
 *  - POST /v1/content/preview-email      → content-generation-service POST /preview-email
 *
 * Asserted: the exact downstream URL, the AUTHENTICATED identity (a caller-supplied
 * x-org-id must not override it), the byte-identical body both ways, and — the one the
 * dashboard branches on — a 402 reaching the caller as a 402 with the downstream body
 * field-for-field. Payloads are fixtures, not a contract this repo owns (CLAUDE.md #6/#8).
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

import audiencesRouter from "../../src/routes/audiences.js";
import contentRouter from "../../src/routes/content.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", contentRouter);
  app.use("/v1", audiencesRouter);
  return app;
}

type Captured = { url: string; method: string; headers: Record<string, string>; body: unknown };
let captured: Captured[] = [];
const originalFetch = global.fetch;

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn(async (url: any, init: any) => {
    captured.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as any;
}

beforeEach(() => {
  captured = [];
});
afterEach(() => {
  global.fetch = originalFetch;
});

const AUDIENCE_ID = "5b1f3c1e-7f55-4c55-9d7a-3c1c8f0f2a11";
const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";

describe("GET /v1/orgs/audiences/:id/preview", () => {
  const PREVIEW = {
    audienceId: AUDIENCE_ID,
    status: "ready",
    reason: null,
    matchCount: 1234,
    companies: [{ name: "Acme", peopleInSample: 3 }],
    people: [{ firstName: "Nina", lastNameObfuscated: "Ni***s", title: "CTO", company: "Acme" }],
    generatedAt: "2026-09-28T10:00:00.000Z",
  };

  it("reaches human-service's own path with the authenticated identity and passes the body through", async () => {
    stubFetch(200, PREVIEW);
    const res = await request(buildApp())
      .get(`/v1/orgs/audiences/${AUDIENCE_ID}/preview`)
      .set("x-org-id", "org_ATTACKER");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(PREVIEW);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/${AUDIENCE_ID}/preview`);
    expect(captured[0].method).toBe("GET");
    expect(captured[0].headers["x-org-id"]).toBe("org_test456");
    expect(captured[0].headers["x-user-id"]).toBe("user_test123");
  });

  it("is not swallowed by the GET /orgs/audiences/:id sibling", async () => {
    stubFetch(200, PREVIEW);
    await request(buildApp()).get(`/v1/orgs/audiences/${AUDIENCE_ID}/preview`);
    expect(captured[0].url.endsWith("/preview")).toBe(true);
  });

  it("forwards a downstream 404 with its status and body", async () => {
    stubFetch(404, { error: "Audience not found" });
    const res = await request(buildApp()).get(`/v1/orgs/audiences/${AUDIENCE_ID}/preview`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Audience not found" });
  });
});

describe("POST /v1/content/preview-email", () => {
  const REQUEST = {
    brandId: BRAND_ID,
    recipient: { firstName: "Nina", lastName: "Smith", title: "CTO", companyName: "Acme" },
    audience: "CTOs at Series A SaaS",
    someFieldThisGatewayHasNeverHeardOf: { nested: true },
  };

  it("reaches content-generation's /preview-email with identity + run and a byte-identical body", async () => {
    const EMAIL = { id: "p1", brandId: BRAND_ID, subject: "Hi", bodyText: "Hello", cached: false };
    stubFetch(200, EMAIL);
    const res = await request(buildApp())
      .post("/v1/content/preview-email")
      .set("x-org-id", "org_ATTACKER")
      .send(REQUEST);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(EMAIL);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`${CONTENT_BASE}/preview-email`);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].body).toEqual(REQUEST);
    expect(captured[0].headers["x-org-id"]).toBe("org_test456");
    expect(captured[0].headers["x-user-id"]).toBe("user_test123");
    expect(captured[0].headers["x-run-id"]).toBe("run_test789");
  });

  it("forwards a 402 as a 402 with the downstream body field-for-field", async () => {
    const REFUSAL = { error: "Insufficient credits", balance_cents: 12, required_cents: 40 };
    stubFetch(402, REFUSAL);
    const res = await request(buildApp()).post("/v1/content/preview-email").send(REQUEST);
    expect(res.status).toBe(402);
    expect(res.body).toEqual(REFUSAL);
  });

  it("forwards a 409 (several offers) with its reason intact", async () => {
    stubFetch(409, { error: "The brand sells several offers; name one with offerId" });
    const res = await request(buildApp()).post("/v1/content/preview-email").send(REQUEST);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "The brand sells several offers; name one with offerId" });
  });
});
