import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/platform-uploads — the staff gate.
 *
 * Own file, deliberately WITHOUT an auth mock: this exercises the real
 * `authenticatePlatform + requireStaff` chain, so "a non-staff signed-in user is
 * refused" is an assertion about the shipped gate and not a property of a stub.
 *
 * The platform key is shared with the CUSTOMER dashboard's server-side proxy, so
 * holding it is NOT staff. The allowlisted `x-email` is the only thing that is.
 */
vi.hoisted(() => {
  process.env.CLOUDFLARE_SERVICE_URL = "http://cloudflare.test.local";
  process.env.CLOUDFLARE_SERVICE_API_KEY = "cloudflare-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import platformUploadsRouter from "../../src/routes/platform-uploads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", platformUploadsRouter);
  return app;
}

const BODY = { contentBase64: "aGVsbG8=", contentType: "image/png" };

describe("POST /v1/platform-uploads — staff gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past the gate, which is
    // the failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from a non-staff request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).post("/v1/platform-uploads").send(BODY);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a call carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .post("/v1/platform-uploads")
      .set("X-API-Key", "not-the-admin-key")
      .set("x-email", "kevin.lourd@gmail.com")
      .send(BODY);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a signed-in NON-STAFF user, even though their dashboard holds the platform key", async () => {
    const res = await request(buildApp())
      .post("/v1/platform-uploads")
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "someone@a-customer.com")
      .send(BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Staff access required");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a platform-keyed call with no email at all", async () => {
    const res = await request(buildApp())
      .post("/v1/platform-uploads")
      .set("X-API-Key", "admin-test-key")
      .send(BODY);
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("admits a staff user, matching the allowlist case-insensitively", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ url: "https://assets.distribute.you/x.png" }),
    }));

    const res = await request(buildApp())
      .post("/v1/platform-uploads")
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "  Kevin.Lourd@Gmail.com  ")
      .send(BODY);

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
