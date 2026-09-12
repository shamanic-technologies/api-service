import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/orgs/uploads — BEHAVIOURAL cover for the customer image upload proxy.
 *
 * The twin of `platform-uploads-behavior.test.ts`, negated: this asset belongs to
 * the CUSTOMER, so the two things only visible on the wire are that it goes to
 * cloudflare-service's ORG-scoped upload (never the platform one) and that the
 * caller's identity rides along — that identity is what opens the run and decides
 * which org the storage cost is declared against. A source-substring test cannot
 * see either, so this drives the real router with a stubbed fetch.
 */

vi.hoisted(() => {
  process.env.CLOUDFLARE_SERVICE_URL = "http://cloudflare.test.local";
  process.env.CLOUDFLARE_SERVICE_API_KEY = "cloudflare-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

// The auth chain is stubbed here so every assertion below is about what goes over
// the wire. The gate itself is exercised for real, unmocked, in
// `org-uploads-auth.test.ts` — a stub cannot testify about a gate.
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "7c2d1e40-9b3a-4c5d-8e6f-0a1b2c3d4e5f";
    req.orgId = "3f1c9a52-2a1b-4b6e-9f0c-1d2e3f4a5b6c";
    req.runId = "b1e2c3d4-5f60-4718-9a2b-3c4d5e6f7a8b";
    req.authType = "admin";
    next();
  },
  authenticatePlatform: (req: any, _res: any, next: any) => {
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

const CLOUDFLARE_BASE = "http://cloudflare.test.local";
const ORG_ID = "3f1c9a52-2a1b-4b6e-9f0c-1d2e3f4a5b6c";
const USER_ID = "7c2d1e40-9b3a-4c5d-8e6f-0a1b2c3d4e5f";
const RUN_ID = "b1e2c3d4-5f60-4718-9a2b-3c4d5e6f7a8b";

import uploadsRouter from "../../src/routes/uploads.js";

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/v1", uploadsRouter);
  return app;
}

const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const UPLOAD_BODY = {
  contentBase64: `data:image/png;base64,${PIXEL_PNG_BASE64}`,
  folder: "brand-logos",
  filename: "acme.png",
  contentType: "image/png",
};

const UPSTREAM_BODY = {
  id: "8f14e45f-ceea-467a-9a0e-5f1d2e3a4b5c",
  url: "https://assets.distribute.you/brand-logos/acme.png",
  size: 68,
  contentType: "image/png",
};

function customerPost(body: unknown) {
  return request(buildApp())
    .post("/v1/orgs/uploads")
    .set("X-API-Key", "admin-test-key")
    .set("x-org-id", ORG_ID)
    .set("x-user-id", USER_ID)
    .set("x-run-id", RUN_ID)
    .send(body as object);
}

describe("POST /v1/orgs/uploads — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(UPSTREAM_BODY) };
    });
  });

  it("forwards to cloudflare-service's ORG-scoped upload, never the platform one", async () => {
    const res = await customerPost(UPLOAD_BODY);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CLOUDFLARE_BASE}/upload/base64`);
    // The platform route stores the file with a NULL org owner and bills nobody —
    // filing a customer's own logo there is the wrong owner and the wrong cost home.
    expect(calls[0].url).not.toBe(`${CLOUDFLARE_BASE}/internal/upload/base64`);
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers["X-API-Key"]).toBe("cloudflare-test-key");
  });

  it("carries the caller's identity, so the org that asked is the org that pays", async () => {
    await customerPost(UPLOAD_BODY);

    const headers = calls[0].options.headers;
    expect(headers["x-org-id"]).toBe(ORG_ID);
    expect(headers["x-user-id"]).toBe(USER_ID);
    // Downstream opens its run under this one; without it the cost has no home.
    expect(headers["x-run-id"]).toBe(RUN_ID);
  });

  it("forwards the body byte-identically, including fields this gateway does not name", async () => {
    const bodyWithFutureField = { ...UPLOAD_BODY, optimizeFor: "email", addedLater: "keep me" };
    await customerPost(bodyWithFutureField);

    expect(JSON.parse(calls[0].options.body)).toEqual(bodyWithFutureField);
  });

  it("returns cloudflare-service's body unchanged, so the browser gets the public URL", async () => {
    const res = await customerPost(UPLOAD_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("propagates an upstream refusal with its status AND its own reason", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: "Invalid request body",
              reason: "contentBase64 must be valid non-empty base64",
            }),
          ),
      };
    });

    const res = await customerPost({ contentBase64: "" });

    expect(res.status).toBe(400);
    // The customer sees cloudflare-service's own sentence, not one this gateway invented.
    expect(res.body.reason).toBe("contentBase64 must be valid non-empty base64");
  });

});
