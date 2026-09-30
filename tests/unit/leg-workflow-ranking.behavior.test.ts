import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { FEATURES_BASE };
});

vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const QS = "featureSlug=sales-cold-email-outreach&leg=start_to_conversation";
// A fixture, not a contract this repo owns — features-service names these fields.
const BODY = { grain: "fleet", computedAt: null, rows: [] };

let calls: Array<{ url: string; options: any }>;
function stub(status: number, body: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  calls = [];
  stub(200, JSON.stringify(BODY));
});

describe("GET /v1/public/features/leg-workflow-ranking", () => {
  it("forwards the query verbatim to the public producer route with no identity", async () => {
    const res = await request(buildApp()).get(`/v1/public/features/leg-workflow-ranking?${QS}&extra=1`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/stats/leg-workflow-ranking?${QS}&extra=1`);
    const h = calls[0].options.headers ?? {};
    expect(h["x-org-id"]).toBeUndefined();
    expect(h["x-user-id"]).toBeUndefined();
    expect(h["x-brand-id"]).toBeUndefined();
  });

  it("forwards a downstream error status and body field-for-field", async () => {
    stub(400, JSON.stringify({ error: "featureSlug and leg are required" }));
    const res = await request(buildApp()).get(`/v1/public/features/leg-workflow-ranking?featureSlug=x`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "featureSlug and leg are required" });
  });
});
