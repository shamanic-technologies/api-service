import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT the auth mock the behaviour test uses: this exercises
// the real `authenticate` + `requireOrg` + `requireUser` chain, so "an unauthenticated
// call is refused" is a real assertion about the shipped gate and not a property of a stub.
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

const BRAND_ID = "7f1c2a3b-4d5e-4f60-8a91-b2c3d4e5f607";

const ROUTES: Array<[string, string]> = [
  ["get", `/v1/brands/${BRAND_ID}/sales-funnels`],
  ["put", `/v1/brands/${BRAND_ID}/sales-funnels`],
  ["put", `/v1/brands/${BRAND_ID}/sales-funnels/reply_meeting`],
  ["delete", `/v1/brands/${BRAND_ID}/sales-funnels/reply_meeting`],
];

describe("brand sales-funnels routes — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    }) as unknown as typeof fetch;
  });

  for (const [method, path] of ROUTES) {
    it(`refuses ${method.toUpperCase()} ${path} with no credentials`, async () => {
      const res = await (request(buildApp()) as any)[method](path).send({});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Missing authentication");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it(`refuses ${method.toUpperCase()} ${path} carrying a wrong platform key`, async () => {
      const res = await (request(buildApp()) as any)
        [method](path)
        .set("X-API-Key", "not-the-admin-key")
        .send({});
      expect(res.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it(`refuses ${method.toUpperCase()} ${path} for an admin-keyed call naming an org it did not authenticate as`, async () => {
      // The platform key is shared with the dashboard's server-side proxy, so it is
      // not an identity: without resolvable identity headers the request never
      // reaches brand-service, and a caller cannot name whose brand to read.
      const res = await (request(buildApp()) as any)
        [method](path)
        .set("X-API-Key", "admin-test-key")
        .set("x-org-id", "someone-elses-org")
        .send({});
      expect(res.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  }
});
