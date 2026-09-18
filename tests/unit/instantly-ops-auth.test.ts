import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT any auth mock: this exercises the real
// `authenticatePlatform` + `requireStaff` pair, so "a non-staff caller is refused" is a
// real assertion about the shipped gate and not a property of a stub.
vi.hoisted(() => {
  process.env.INSTANTLY_SERVICE_URL = "http://instantly.test.local";
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
});

import instantlyRouter from "../../src/routes/instantly.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", instantlyRouter);
  return app;
}

const ROUTES = [
  "/v1/instantly/ops/lifecycle-rules",
  "/v1/instantly/ops/domains",
  "/v1/instantly/ops/mailboxes",
  "/v1/instantly/ops/addresses",
  "/v1/instantly/ops/infra",
  "/v1/instantly/ops/threads?limit=10",
  "/v1/instantly/ops/messages?limit=10",
  "/v1/instantly/ops/messages/abc/body",
];

describe("/v1/instantly/ops/* — staff gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past the gate, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from a non-staff request");
    });
  });

  for (const path of ROUTES) {
    it(`refuses GET ${path} with no credentials`, async () => {
      const res = await request(buildApp()).get(path);
      expect(res.status).toBe(401);
    });

    it(`refuses GET ${path} with the platform key but a non-staff email`, async () => {
      const res = await request(buildApp())
        .get(path)
        .set("x-api-key", "platform-test-key")
        .set("x-email", "someone@customer.example");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Staff access required");
    });

    it(`refuses GET ${path} with a staff email but no platform key`, async () => {
      const res = await request(buildApp()).get(path).set("x-email", "kevin.lourd@gmail.com");
      expect(res.status).toBe(401);
    });
  }
});
