import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT any auth mock: this exercises the real
// `authenticatePlatform` + `requireStaff` pair, so "a non-staff caller is refused" is a
// real assertion about the shipped gate and not a property of a stub.
vi.hoisted(() => {
  process.env.FEATURES_SERVICE_URL = "http://features.test.local";
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
});

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const ID = "6c9a6c2e-6c1f-4b0a-9a3e-2f7c1b4d5e6f";

const ROUTES: Array<[string, string]> = [
  ["get", "/v1/features/stated-monthly-amounts"],
  ["post", "/v1/features/stated-monthly-amounts"],
  ["patch", `/v1/features/stated-monthly-amounts/${ID}`],
  ["delete", `/v1/features/stated-monthly-amounts/${ID}`],
];

describe("/v1/features/stated-monthly-amounts — staff gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past the gate, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from a non-staff request");
    });
  });

  for (const [method, path] of ROUTES) {
    it(`refuses ${method.toUpperCase()} ${path} with no credentials`, async () => {
      const res = await (request(buildApp()) as any)[method](path);
      expect(res.status).toBe(401);
    });

    it(`refuses ${method.toUpperCase()} ${path} with the platform key but a non-staff email`, async () => {
      const res = await (request(buildApp()) as any)
        [method](path)
        .set("x-api-key", "platform-test-key")
        .set("x-email", "someone@customer.example");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Staff access required");
    });

    it(`refuses ${method.toUpperCase()} ${path} with a staff email but no platform key`, async () => {
      const res = await (request(buildApp()) as any)
        [method](path)
        .set("x-email", "kevin.lourd@gmail.com");
      expect(res.status).toBe(401);
    });
  }
});
