import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/orgs/uploads — the customer gate.
 *
 * Own file, deliberately WITHOUT an auth mock, mirroring
 * `platform-uploads-auth.test.ts`: a stub cannot testify about a gate, so the
 * shipped `authenticate + requireOrg + requireUser` chain runs for real here.
 *
 * What matters is the pair, not just the refusal: an upload with no ORG has
 * nobody to own the file and no org to declare its storage cost against, and one
 * with no USER cannot open a run. Either missing must stop BEFORE any outbound
 * call — a file stored under a null owner is not a degraded upload, it is an
 * unbilled asset nobody can find again.
 */
vi.hoisted(() => {
  process.env.CLOUDFLARE_SERVICE_URL = "http://cloudflare.test.local";
  process.env.CLOUDFLARE_SERVICE_API_KEY = "cloudflare-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import uploadsRouter from "../../src/routes/uploads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", uploadsRouter);
  return app;
}

const BODY = { contentBase64: "aGVsbG8=", contentType: "image/png" };
const ORG_ID = "3f1c9a52-2a1b-4b6e-9f0c-1d2e3f4a5b6c";
const USER_ID = "7c2d1e40-9b3a-4c5d-8e6f-0a1b2c3d4e5f";

describe("POST /v1/orgs/uploads — customer gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past the gate, which is
    // the failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).post("/v1/orgs/uploads").send(BODY);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a call carrying an unknown key", async () => {
    const res = await request(buildApp())
      .post("/v1/orgs/uploads")
      .set("X-API-Key", "not-a-real-key")
      .set("x-org-id", ORG_ID)
      .set("x-user-id", USER_ID)
      .send(BODY);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an authenticated call that names no org — the file would have no owner", async () => {
    const res = await request(buildApp())
      .post("/v1/orgs/uploads")
      .set("X-API-Key", "admin-test-key")
      .set("x-user-id", USER_ID)
      .send(BODY);
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an authenticated call that names no user — nothing could open the run", async () => {
    const res = await request(buildApp())
      .post("/v1/orgs/uploads")
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", ORG_ID)
      .send(BODY);
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
