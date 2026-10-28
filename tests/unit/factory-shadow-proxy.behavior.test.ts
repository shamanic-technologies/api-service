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
 * FACTORY-P1-GATEWAY: the GTM Factory shadow reads relayed to features-service.
 *   customer  GET /v1/features/brands/:brandId/sales-funnel-campaigns/:id/factory-shadow → /brands/{brandId}/sales-funnel-campaigns/{id}/factory-shadow
 *   staff     GET /v1/features/audit/factory-shadow/monitoring → /internal/factory-shadow/monitoring
 *   staff     GET /v1/features/audit/factory-shadow/eval       → /internal/factory-shadow/eval
 * Real requireOrg / requireUser / requireStaff / requireStaffActor / authenticatePlatform; only `authenticate`
 * and `authenticateUser` (network: client-service, key-service, runs-service) are stubbed with the identity under test.
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
import { STAFF_KEY_OPERATIONS } from "../../src/openapi/document.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", featuresRouter);
  return a;
}

const BRAND = "933d4abb-9695-4fcb-b3aa-354d61565798";
const SFC = "7fcf42ab-fe7a-46a5-9375-90fbdd260f18";
// Odd spacing + unknown field on purpose: the producer owns the shape.
const RAW = '{"campaignId":"x", "pipes":[{"pipeId":"p","pickedPlayId":"a","runningPlayId":"b"}],"someNewField":true}';

const CLIENT = { authType: "user_key", orgId: "org-client", userId: "user-client", runId: "run-1", userKeyScope: { isStaff: false, email: "client@acme.com", memberships: [] } };
const STAFF_KEY = { authType: "user_key", userId: "user-staff", runId: "run-2", userKeyScope: { isStaff: true, email: "Kevin@Distribute.you", memberships: [] } };

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

describe("customer — GET /v1/features/brands/:brandId/sales-funnel-campaigns/:salesFunnelCampaignId/factory-shadow", () => {
  const path = `/v1/features/brands/${BRAND}/sales-funnel-campaigns/${SFC}/factory-shadow`;

  it("forwards to the exact producer path, query verbatim, the AUTHENTICATED org (a caller-sent org is ignored), body field-for-field", async () => {
    identity.current = CLIENT;
    upstream(200, RAW);
    const q = "?a=1&a=2";
    const res = await request(app()).get(`${path}${q}`).set("Authorization", "Bearer distrib.usr_client").set("x-org-id", "org-victim");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(RAW));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/brands/${BRAND}/sales-funnel-campaigns/${SFC}/factory-shadow${q}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org-client");
    expect(calls[0].init.headers["x-user-id"]).toBe("user-client");
    expect(calls[0].init.headers["x-run-id"]).toBe("run-1");
  });

  it("relays the producer's 404 factory_shadow_not_computed field-for-field (another org's campaign is the producer's 404 too)", async () => {
    identity.current = CLIENT;
    const raw = '{"error":"Factory shadow not computed yet","code":"factory_shadow_not_computed"}';
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

  it("does not disturb the sibling next-steps route", async () => {
    identity.current = CLIENT;
    upstream(200, RAW);
    await request(app()).get(`/v1/features/brands/${BRAND}/sales-funnel-campaigns/${SFC}/next-steps`);
    expect(new URL(calls[0].url).pathname).toBe(`/brands/${BRAND}/sales-funnel-campaigns/${SFC}/next-steps`);
  });
});

for (const view of ["monitoring", "eval"] as const) {
  const path = `/v1/features/audit/factory-shadow/${view}`;
  const downstream = `${FEATURES_BASE}/internal/factory-shadow/${view}`;

  describe(`staff — GET ${path}`, () => {
    it("is a staff-key operation (stripped from the customer document, served to a staff key)", () => {
      expect(STAFF_KEY_OPERATIONS.has(`GET ${path}`)).toBe(true);
    });

    it("a staff member's own key reads it: query verbatim, service key, no org, body byte-for-byte", async () => {
      identity.current = STAFF_KEY;
      upstream(200, RAW);
      const res = await request(app()).get(`${path}?days=30`).set("Authorization", "Bearer distrib.usr_staff");
      expect(res.status).toBe(200);
      expect(res.text).toBe(RAW);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${downstream}?days=30`);
      expect(calls[0].init.headers["X-API-Key"]).toBe("features-test-key");
      expect(calls[0].init.headers["x-org-id"]).toBeUndefined();
    });

    it("the dashboard's platform key + staff x-email reads it (no identity headers needed)", async () => {
      upstream(200, RAW);
      const res = await request(app()).get(path).set("X-API-Key", "platform-test-key").set("x-email", "kevin@distribute.you");
      expect(res.status).toBe(200);
      expect(res.text).toBe(RAW);
      expect(calls[0].url).toBe(downstream);
    });

    it("a customer key gets 403 staff_only and nothing is called", async () => {
      identity.current = CLIENT;
      upstream(200, RAW);
      const res = await request(app()).get(path).set("Authorization", "Bearer distrib.usr_client");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("staff_only");
      expect(calls).toHaveLength(0);
    });

    it("the platform key with a customer x-email gets 403 and nothing is called", async () => {
      upstream(200, RAW);
      const res = await request(app()).get(path).set("X-API-Key", "platform-test-key").set("x-email", "client@acme.com");
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it("passes a downstream refusal through with its status and body", async () => {
      identity.current = STAFF_KEY;
      const raw = '{"error":"days must be 1..90","code":"BAD_QUERY"}';
      upstream(400, raw);
      const res = await request(app()).get(`${path}?days=999`).set("Authorization", "Bearer distrib.usr_staff");
      expect(res.status).toBe(400);
      expect(res.body).toEqual(JSON.parse(raw));
    });

    it("never exposes the POST trigger", async () => {
      identity.current = STAFF_KEY;
      upstream(202, '{"started":true}');
      const res = await request(app()).post(path).set("Authorization", "Bearer distrib.usr_staff");
      expect(res.status).toBe(404);
      expect(calls).toHaveLength(0);
    });
  });
}
