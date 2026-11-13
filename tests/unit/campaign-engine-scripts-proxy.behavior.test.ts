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

/**
 * CAMPAIGN-SCRIPTS-1113-GATEWAY: a campaign's Engines in scripts, relayed to features-service.
 *   GET /v1/features/brands/:brandId/sales-funnel-campaigns/:id/engine-scripts → /brands/{brandId}/sales-funnel-campaigns/{id}/engine-scripts
 * Real requireOrg / requireUser; only `authenticate` (network) is stubbed with the identity under test.
 */
const identity = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  const stub = (req: any, _res: any, next: any) => {
    Object.assign(req, identity.current);
    next();
  };
  return { ...actual, authenticate: stub, authenticateUser: stub };
});

import featuresRouter from "../../src/routes/features.js";
import { buildDocument } from "../../src/openapi/document.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", featuresRouter);
  return a;
}

const BRAND = "933d4abb-9695-4fcb-b3aa-354d61565798";
const SFC = "7fcf42ab-fe7a-46a5-9375-90fbdd260f18";
// Odd spacing + unknown field on purpose: the producer owns the shape.
const RAW = '{"campaignId":"x", "engines":[{"outcome":"Lead found","scripts":[{"id":"s1"}]}],"someNewField":true}';

const CLIENT = { authType: "user_key", orgId: "org-client", userId: "user-client", runId: "run-1", userKeyScope: { isStaff: false, email: "client@acme.com", memberships: [] } };

let calls: Array<{ url: string; init: any }>;
function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(raw, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  calls = [];
  identity.current = {};
});

describe("customer — GET /v1/features/brands/:brandId/sales-funnel-campaigns/:salesFunnelCampaignId/engine-scripts", () => {
  const path = `/v1/features/brands/${BRAND}/sales-funnel-campaigns/${SFC}/engine-scripts`;

  it("forwards to the exact producer path, query verbatim, the AUTHENTICATED identity (a caller-sent org is ignored), body field-for-field", async () => {
    identity.current = CLIENT;
    upstream(200, RAW);
    const q = "?a=1&a=2";
    const res = await request(app()).get(`${path}${q}`).set("Authorization", "Bearer distrib.usr_client").set("x-org-id", "org-victim");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(RAW));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/brands/${BRAND}/sales-funnel-campaigns/${SFC}/engine-scripts${q}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org-client");
    expect(calls[0].init.headers["x-user-id"]).toBe("user-client");
    expect(calls[0].init.headers["x-run-id"]).toBe("run-1");
  });

  it("relays the producer's 404 field-for-field (another org's campaign is the producer's 404)", async () => {
    identity.current = CLIENT;
    const raw = '{"error":"Sales funnel campaign not found","code":"sales_funnel_campaign_not_found"}';
    upstream(404, raw);
    const res = await request(app()).get(path);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("refuses a caller with no org (400) and calls nothing", async () => {
    identity.current = { authType: "user_key", userId: "user-client" };
    upstream(200, RAW);
    const res = await request(app()).get(path);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("is on the customer document", () => {
    const doc = buildDocument() as any;
    expect(doc.paths["/v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/engine-scripts"]?.get).toBeDefined();
  });
});
