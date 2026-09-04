import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * The query string on the emails reads is a passthrough (CLAUDE.md #11).
 *
 * These drive the REAL router with a stubbed `global.fetch` and assert the URL that goes over
 * the wire, because a source-substring test cannot see what a template literal interpolates —
 * and a whitelist is invisible in the source until someone asks for a parameter it does not
 * name. The decisive case in every block below is a parameter this gateway has never heard of:
 * it must arrive downstream intact, exactly like the ones the OpenAPI document happens to list.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  requireOrg: (req: any, res: any, next: any) => {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    next();
  },
  requireUser: (req: any, res: any, next: any) => {
    if (!req.userId) return res.status(401).json({ error: "User identity required" });
    next();
  },
  AuthenticatedRequest: {},
}));

import emailsRoutes from "../../src/routes/emails.js";

let urls: string[] = [];

function createApp(payload: unknown) {
  urls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    urls.push(url);
    return { ok: true, json: () => Promise.resolve(payload) };
  });
  const app = express();
  app.use(express.json());
  app.use("/v1", emailsRoutes);
  return app;
}

function downstream(fragment: string): string {
  const hit = urls.find((u) => u.includes(fragment));
  expect(hit, `no downstream call matching ${fragment}; saw ${JSON.stringify(urls)}`).toBeDefined();
  return hit!;
}

describe("GET /v1/emails/by-lead/:leadId — query passthrough", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("forwards the campaign scope a person's nested campaign card asks for", async () => {
    const app = createApp({ generation: { id: "gen_1" } });

    const res = await request(app).get(
      "/v1/emails/by-lead/lead_abc?campaignId=99999999-8888-7777-6666-555555555555",
    );

    expect(res.status).toBe(200);
    expect(downstream("/generations/by-lead/")).toContain(
      "/generations/by-lead/lead_abc?campaignId=99999999-8888-7777-6666-555555555555",
    );
  });

  it("forwards a parameter this gateway does not know about", async () => {
    const app = createApp({ generation: null });

    await request(app).get("/v1/emails/by-lead/lead_abc?somethingNobodyHasShippedYet=42");

    expect(downstream("/generations/by-lead/")).toContain("somethingNobodyHasShippedYet=42");
  });

  it("forwards several scopes together, in the caller's own order and encoding", async () => {
    const app = createApp({ generation: { id: "gen_2" } });

    await request(app).get(
      "/v1/emails/by-lead/lead_abc?campaignId=camp_1&brandId=brand_1&note=a%20b",
    );

    const url = downstream("/generations/by-lead/");
    expect(url).toContain("?campaignId=camp_1&brandId=brand_1&note=a%20b");
  });

  it("sends no query string at all when the caller sent none", async () => {
    const app = createApp({ generation: { id: "gen_3" } });

    await request(app).get("/v1/emails/by-lead/lead_abc");

    expect(downstream("/generations/by-lead/")).not.toContain("?");
  });
});

describe("GET /v1/emails — query passthrough", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("forwards an unknown filter alongside the brandId this gateway requires", async () => {
    const app = createApp({ generations: [] });

    const res = await request(app).get("/v1/emails?brandId=brand_1&aFilterShippedLater=yes");

    expect(res.status).toBe(200);
    const url = downstream("/generations?");
    expect(url).toContain("brandId=brand_1");
    expect(url).toContain("aFilterShippedLater=yes");
  });

  it("still 400s when the caller names no brand — the gateway's own guard, not a whitelist", async () => {
    const app = createApp({ generations: [] });

    const res = await request(app).get("/v1/emails?aFilterShippedLater=yes");

    expect(res.status).toBe(400);
    expect(urls).toEqual([]);
  });
});

describe("GET /v1/workflow-examples — query passthrough", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("forwards an unknown parameter alongside the required workflowSlug", async () => {
    const app = createApp({ examples: [] });

    const res = await request(app).get(
      "/v1/workflow-examples?workflowSlug=cold-email&aFilterShippedLater=yes",
    );

    expect(res.status).toBe(200);
    const url = downstream("/generations/examples");
    expect(url).toContain("workflowSlug=cold-email");
    expect(url).toContain("aFilterShippedLater=yes");
  });

  it("still 400s without workflowSlug", async () => {
    const app = createApp({ examples: [] });

    const res = await request(app).get("/v1/workflow-examples?aFilterShippedLater=yes");

    expect(res.status).toBe(400);
    expect(urls).toEqual([]);
  });
});

describe("GET /v1/emails/manual-qualifications — query passthrough", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("forwards an unknown filter to instantly-service through email-gateway", async () => {
    const app = createApp({ qualifications: [] });

    const res = await request(app).get(
      "/v1/emails/manual-qualifications?campaign_id=camp_1&aFilterShippedLater=yes",
    );

    expect(res.status).toBe(200);
    const url = downstream("/orgs/manual-qualifications");
    expect(url).toContain("campaign_id=camp_1");
    expect(url).toContain("aFilterShippedLater=yes");
  });

  it("sends no query string at all when the caller sent none", async () => {
    const app = createApp({ qualifications: [] });

    await request(app).get("/v1/emails/manual-qualifications");

    expect(downstream("/orgs/manual-qualifications")).not.toContain("?");
  });
});

describe("GET /v1/emails/stats — the org boundary is not a whitelist to remove", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads the org from the authenticated session and ignores a caller-supplied one", async () => {
    const app = createApp({ stats: { totalEmails: 0, sent: 0, failed: 0 } });

    const res = await request(app).get("/v1/emails/stats?orgId=someone_elses_org");

    expect(res.status).toBe(200);
    const url = downstream("/stats?");
    expect(url).toContain("orgId=org_test456");
    expect(url).not.toContain("someone_elses_org");
  });
});
