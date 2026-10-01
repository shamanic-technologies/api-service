import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/matrix/links* must forward to crm-service's own /orgs/matrix/links* —
 * path preserved, query string byte-copied, body forwarded verbatim, and every
 * refusal (409 channel_unavailable, 422 bridge) returned with the SAME status and
 * the SAME JSON body: those bodies carry the reason the user reads.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import crmRouter from "../../src/routes/crm.js";

const CRM_BASE = "http://crm.test.local";
const BRAND = "bbbbbbbb-1111-4111-8111-000000000001";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", crmRouter);
  return app;
}

describe("/v1/orgs/matrix/links* → crm-service", () => {
  let calls: Array<{ url: string; options: any }>;

  function upstreamOnce(status: number, body: unknown) {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      const text = JSON.stringify(body);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(text),
      };
    });
  }

  beforeEach(() => {
    process.env.CRM_SERVICE_URL = CRM_BASE;
    process.env.CRM_SERVICE_API_KEY = "crm-test-key";
    calls = [];
    global.fetch = vi.fn();
  });

  afterEach(() => {
    delete process.env.CRM_SERVICE_URL;
    delete process.env.CRM_SERVICE_API_KEY;
  });

  it("POST forwards the body byte-identical + org and user identity, returns the link", async () => {
    const body = { brandId: BRAND, channel: "whatsapp", method: "phone", phoneNumber: "+33612345678" };
    const upstream = { link: { channel: "whatsapp", state: "pairing", pairingCode: "ABCD-EFGH" } };
    upstreamOnce(200, upstream);

    const res = await request(buildApp()).post("/v1/orgs/matrix/links").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/matrix/links`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    // brandId lives in the body only: the gateway does not promote it to a header.
    expect(calls[0].options.headers["x-brand-id"]).toBeUndefined();
  });

  it("a crm-service 409 reaches the caller as 409 with the same JSON body", async () => {
    const upstream = {
      type: "channel_unavailable",
      channel: "telegram",
      error: "Telegram linking is not available yet",
    };
    upstreamOnce(409, upstream);

    const res = await request(buildApp())
      .post("/v1/orgs/matrix/links")
      .send({ brandId: BRAND, channel: "telegram", method: "qr" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(upstream);
  });

  it("a crm-service 422 bridge refusal reaches the caller as 422 with the same JSON body", async () => {
    const upstream = {
      type: "bridge",
      bridgeError: { code: "bad_phone", message: "That phone number is not on WhatsApp" },
      link: { channel: "whatsapp", state: "failed" },
    };
    upstreamOnce(422, upstream);

    const res = await request(buildApp())
      .post("/v1/orgs/matrix/links")
      .send({ brandId: BRAND, channel: "whatsapp", method: "phone", phoneNumber: "+1" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual(upstream);
  });

  it("GET forwards the whole query string verbatim", async () => {
    const upstream = { links: [{ channel: "whatsapp", state: "qr", qr: "2@abc" }] };
    upstreamOnce(200, upstream);

    const res = await request(buildApp()).get(`/v1/orgs/matrix/links?brandId=${BRAND}&x=a&x=b`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/matrix/links?brandId=${BRAND}&x=a&x=b`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("DELETE forwards the channel in the path and the query string", async () => {
    const upstream = { unlinked: true, contactsRemoved: 3, connectionRemoved: true, link: null };
    upstreamOnce(200, upstream);

    const res = await request(buildApp()).delete(`/v1/orgs/matrix/links/whatsapp?brandId=${BRAND}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/matrix/links/whatsapp?brandId=${BRAND}`);
    expect(calls[0].options.method).toBe("DELETE");
  });

  it("DELETE propagates a 404 body verbatim", async () => {
    const upstream = { error: "No whatsapp link for this brand" };
    upstreamOnce(404, upstream);

    const res = await request(buildApp()).delete(`/v1/orgs/matrix/links/whatsapp?brandId=${BRAND}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(upstream);
  });
});
