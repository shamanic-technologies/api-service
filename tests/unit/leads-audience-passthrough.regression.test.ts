import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression test (api-service#637): GET /v1/leads is a transparent proxy to
 * lead-service GET /orgs/leads. Each lead's new `audience` object
 * ({ id, name, avatarUrl } | null, resolved server-side by lead-service#346)
 * MUST be forwarded byte-identical on both the basic and full views — no
 * stripping, no re-declaring downstream fields (per CLAUDE.md rules #6/#8).
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import leadsRouter from "../../src/routes/leads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", leadsRouter);
  return app;
}

// Upstream body exactly as lead-service returns it, including the new per-lead
// `audience` object and one lead with `audience: null` (no audience resolved).
const upstreamBody = {
  leads: [
    {
      id: "row-1",
      leadId: "lead-1",
      email: "a@example.com",
      status: "active",
      audience: { id: "aud-1", name: "Founders", avatarUrl: "https://cdn/x.png" },
      lead: { firstName: "A" },
    },
    {
      id: "row-2",
      leadId: "lead-2",
      email: "b@example.com",
      status: "active",
      audience: null,
      lead: { firstName: "B" },
    },
  ],
};

describe("GET /v1/leads — per-lead audience passthrough (#637)", () => {
  let capturedUrls: string[];

  beforeEach(() => {
    capturedUrls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrls.push(url);
      return { ok: true, json: () => Promise.resolve(upstreamBody) };
    });
  });

  it("forwards the upstream body verbatim (audience included) on view=basic", async () => {
    const res = await request(buildApp()).get(
      "/v1/leads?brandId=11111111-1111-1111-1111-111111111111&view=basic"
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstreamBody);
  });

  it("forwards the upstream body verbatim (audience included) on the full view", async () => {
    const res = await request(buildApp()).get(
      "/v1/leads?brandId=11111111-1111-1111-1111-111111111111"
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstreamBody);
  });

  it("does not strip or transform the audience object on any lead", async () => {
    const res = await request(buildApp()).get(
      "/v1/leads?brandId=11111111-1111-1111-1111-111111111111&view=basic"
    );
    expect(res.body.leads[0].audience).toEqual({
      id: "aud-1",
      name: "Founders",
      avatarUrl: "https://cdn/x.png",
    });
    expect(res.body.leads[1].audience).toBeNull();
  });

  it("forwards view=basic to lead-service /orgs/leads", async () => {
    await request(buildApp()).get(
      "/v1/leads?brandId=11111111-1111-1111-1111-111111111111&view=basic"
    );
    const call = capturedUrls.find((u) => u.includes("/orgs/leads"));
    expect(call).toBeDefined();
    expect(call).toContain("view=basic");
  });
});
