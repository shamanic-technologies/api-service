import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set it before the imports.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { FEATURES_BASE };
});

/**
 * features-service's live Research studies, STAFF ONLY (the actual basis reveals margin).
 * Deliberately NO auth mock: the real authenticatePlatform + requireStaff run, and every
 * refusal asserts ZERO outbound calls.
 */

const { createRun } = vi.hoisted(() => ({ createRun: vi.fn() }));
vi.mock("@distribute/runs-client", () => ({
  createRun,
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const STAFF = { "x-api-key": "platform-test-key", "x-email": "kevin@distribute.you" };
// A fixture, not a contract this repo owns.
const BODY = { basis: "actual", studies: [{ id: "s1" }] };

let calls: Array<{ url: string; options: any }>;

function stub(status: number, body: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  calls = [];
  createRun.mockReset().mockResolvedValue({ id: "run-1" });
  stub(200, JSON.stringify(BODY));
});

const ROUTES: Array<[string, string]> = [
  ["/v1/features/research?basis=actual", "/internal/research?basis=actual"],
  ["/v1/features/research?basis=user&x=1&x=2", "/internal/research?basis=user&x=1&x=2"],
  ["/v1/features/research/conclusions", "/internal/research/conclusions"],
  ["/v1/features/research/studies", "/internal/research/studies"],
  ["/v1/features/research/catalog?basis=actual", "/internal/research/catalog?basis=actual"],
  ["/v1/features/research/catalog", "/internal/research/catalog"],
  ["/v1/features/research/templates", "/internal/research/templates"],
  ["/v1/features/research/performance?basis=actual", "/internal/research/performance?basis=actual"],
  ["/v1/features/research/performance", "/internal/research/performance"],
];

describe.each(ROUTES)("GET %s — staff", (path, downstream) => {
  it("forwards to the internal producer route with the service key and staff email, body verbatim", async () => {
    const res = await request(buildApp()).get(path).set(STAFF);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}${downstream}`);
    expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
    expect(calls[0].options.headers["x-email"]).toBe("kevin@distribute.you");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("passes the 503 research_not_computed_yet through, status and body", async () => {
    const err = { error: "Research not computed yet", code: "research_not_computed_yet" };
    stub(503, JSON.stringify(err));
    const res = await request(buildApp()).get(path).set(STAFF);
    expect(res.status).toBe(503);
    expect(res.body).toEqual(err);
  });

  it("403s a platform-keyed caller whose email is not staff (customer session), before any call", async () => {
    const res = await request(buildApp()).get(path).set({ ...STAFF, "x-email": "someone@customer.example" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("403s a platform-keyed caller with no email", async () => {
    const res = await request(buildApp()).get(path).set({ "x-api-key": "platform-test-key" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("401s a customer bearer key, even with a staff email", async () => {
    const res = await request(buildApp()).get(path).set({ authorization: "Bearer distrib.usr_x", "x-email": "kevin@distribute.you" });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("401s with no credentials", async () => {
    const res = await request(buildApp()).get(path);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
