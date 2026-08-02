import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/platform-uploads — BEHAVIOURAL cover for the staff image upload proxy.
 *
 * A source-substring test cannot see what goes over the wire (CLAUDE.md rule #7,
 * corollary 3), and three things here are only true on the wire: the downstream path
 * is cloudflare-service's PLATFORM (org-less) upload and not one of its two org-scoped
 * ones, no org/user identity is attached to what must be a platform asset, and the body
 * is forwarded byte-identically. This file drives the real router with supertest and a
 * stubbed fetch to assert all three.
 */

// The cloudflare entry reads its env lazily (per call), but the staff gate reads
// ADMIN_DISTRIBUTE_API_KEY at request time too — set both before the router imports.
vi.hoisted(() => {
  process.env.CLOUDFLARE_SERVICE_URL = "http://cloudflare.test.local";
  process.env.CLOUDFLARE_SERVICE_API_KEY = "cloudflare-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

const CLOUDFLARE_BASE = "http://cloudflare.test.local";
const STAFF_EMAIL = "kevin.lourd@gmail.com";

import platformUploadsRouter from "../../src/routes/platform-uploads.js";

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/v1", platformUploadsRouter);
  return app;
}

function staffPost(body: unknown) {
  return request(buildApp())
    .post("/v1/platform-uploads")
    .set("X-API-Key", "admin-test-key")
    .set("x-email", STAFF_EMAIL)
    .send(body as object);
}

// A one-pixel PNG, the smallest thing that is genuinely an image.
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const UPLOAD_BODY = {
  contentBase64: `data:image/png;base64,${PIXEL_PNG_BASE64}`,
  folder: "investor-updates",
  filename: "chart.png",
  contentType: "image/png",
};

const UPSTREAM_BODY = {
  id: "8f14e45f-ceea-467a-9a0e-5f1d2e3a4b5c",
  url: "https://assets.distribute.you/investor-updates/chart.png",
  size: 68,
  contentType: "image/png",
};

describe("POST /v1/platform-uploads — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(UPSTREAM_BODY) };
    });
  });

  it("forwards to cloudflare-service's platform upload path, keyed as a service caller", async () => {
    const res = await staffPost(UPLOAD_BODY);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CLOUDFLARE_BASE}/internal/upload/base64`);
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers["X-API-Key"]).toBe("cloudflare-test-key");
    // platformAuth downstream 400s without this header.
    expect(calls[0].options.headers["x-service-name"]).toBe("api-service");
  });

  it("does not send it to either of the ORG-scoped upload routes", async () => {
    await staffPost(UPLOAD_BODY);

    // cloudflare-service also serves `/upload` (fetches a sourceUrl) and
    // `/upload/base64` (org-scoped, billed to the org). Both would be wrong here,
    // and a path built from the right pieces satisfies a prefix assertion — so pin
    // the whole literal and negate the two near-misses.
    expect(calls[0].url).toBe(`${CLOUDFLARE_BASE}/internal/upload/base64`);
    expect(calls[0].url).not.toBe(`${CLOUDFLARE_BASE}/upload/base64`);
    expect(calls[0].url).not.toBe(`${CLOUDFLARE_BASE}/upload`);
  });

  it("attaches no org, user or run identity — the asset is the platform's, not a customer's", async () => {
    await staffPost(UPLOAD_BODY);

    const headers = calls[0].options.headers;
    expect(headers["x-org-id"]).toBeUndefined();
    expect(headers["x-user-id"]).toBeUndefined();
    expect(headers["x-run-id"]).toBeUndefined();
  });

  it("ignores a caller-supplied org — a staff upload can never be billed to a customer", async () => {
    await request(buildApp())
      .post("/v1/platform-uploads?orgId=someone-elses-org")
      .set("X-API-Key", "admin-test-key")
      .set("x-email", STAFF_EMAIL)
      .set("x-org-id", "someone-elses-org")
      .send(UPLOAD_BODY);

    expect(calls[0].url).toBe(`${CLOUDFLARE_BASE}/internal/upload/base64`);
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("forwards the body byte-identically, including fields this gateway does not name", async () => {
    const bodyWithFutureField = { ...UPLOAD_BODY, somethingCloudflareAddsLater: "keep me" };
    await staffPost(bodyWithFutureField);

    expect(JSON.parse(calls[0].options.body)).toEqual(bodyWithFutureField);
  });

  it("returns cloudflare-service's body unchanged, so the composer gets the public URL", async () => {
    const res = await staffPost(UPLOAD_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("propagates an upstream failure with its status AND its body intact", async () => {
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
        json: () => Promise.resolve({}),
      };
    });

    const res = await staffPost({ contentBase64: "" });

    // Not flattened into { error: "<the whole JSON body>" } — `reason` survives (CLAUDE.md #7).
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Invalid request body",
      reason: "contentBase64 must be valid non-empty base64",
    });
  });

  it("carries a ~5MB image without the gateway truncating or rejecting it", async () => {
    // 5MB of raw bytes → ~6.7MB of base64, the size the composer actually sends.
    const fiveMegabytes = Buffer.alloc(5 * 1024 * 1024, 0x41).toString("base64");
    const res = await staffPost({ contentBase64: fiveMegabytes, contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(JSON.parse(calls[0].options.body).contentBase64).toBe(fiveMegabytes);
  });
});
