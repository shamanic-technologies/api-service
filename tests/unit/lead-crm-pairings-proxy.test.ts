import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * The CRM-pairing surface: two reads that already resolve through `GET /v1/leads/:id`,
 * and the write + retraction this gateway forwards explicitly.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes over
 * the wire — the downstream path, the method, the identity headers, the query string and
 * the body. A source-substring test cannot see what a template literal interpolates and
 * cannot see identity at all (CLAUDE.md rule #7, corollary 3).
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
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

const BRAND = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const CONTACT = "crm_contact_9";

describe("CRM pairings — the two reads resolve without a route of their own", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response('{"pairings":[],"unknownDownstreamField":7}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });

  it("GET /v1/leads/crm-pairings reaches lead-service /orgs/leads/crm-pairings", async () => {
    const query = `?brandId=${BRAND}&limit=50&offset=100&somethingBrandNew=x`;
    const res = await request(buildApp()).get(`/v1/leads/crm-pairings${query}`);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    // The literal segment is forwarded as itself — lead-service registers this path
    // ahead of its own `/orgs/leads/:id`, so it is not read as a lead id there either.
    expect(calls[0].url.endsWith(`/orgs/leads/crm-pairings${query}`)).toBe(true);
    expect(calls[0].init.method ?? "GET").toBe("GET");
    expect(res.body.unknownDownstreamField).toBe(7);
  });

  it("GET /v1/leads/crm-pairing-counts reaches lead-service /orgs/leads/crm-pairing-counts", async () => {
    const res = await request(buildApp()).get(`/v1/leads/crm-pairing-counts?brandId=${BRAND}`);

    expect(res.status).toBe(200);
    expect(calls[0].url.endsWith(`/orgs/leads/crm-pairing-counts?brandId=${BRAND}`)).toBe(true);
  });

  it("sends the AUTHENTICATED org on those reads, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/leads/crm-pairings?brandId=${BRAND}&orgId=org_someone_else`)
      .set("x-org-id", "org_someone_else");

    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    // The parameter still travels verbatim — it just is not identity.
    expect(calls[0].url).toContain("orgId=org_someone_else");
  });
});

describe("POST /v1/leads/crm-pairings/rulings — a human accepts or denies a pairing", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response('{"ruling":{"ruling":"accepted","leadId":"' + LEAD + '"}}', {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
  });

  it("forwards to lead-service POST /orgs/leads/crm-pairings/rulings", async () => {
    const res = await request(buildApp())
      .post("/v1/leads/crm-pairings/rulings")
      .send({ brandId: BRAND, crmContactId: CONTACT, leadId: LEAD, ruling: "accepted" });

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith("/orgs/leads/crm-pairings/rulings")).toBe(true);
    expect(calls[0].init.method).toBe("POST");
  });

  it("forwards the body VERBATIM, including a field this gateway has never heard of", async () => {
    const body = {
      brandId: BRAND,
      crmContactId: CONTACT,
      leadId: LEAD,
      ruling: "denied",
      note: "different person, same surname",
      somethingLeadServiceShipsLater: { nested: true },
    };
    await request(buildApp()).post("/v1/leads/crm-pairings/rulings").send(body);

    expect(JSON.parse(calls[0].init.body)).toEqual(body);
  });

  it("carries the caller's user, because lead-service records WHO ruled", async () => {
    await request(buildApp())
      .post("/v1/leads/crm-pairings/rulings")
      .set("x-org-id", "org_someone_else")
      .set("x-user-id", "user_someone_else")
      .send({ brandId: BRAND, crmContactId: CONTACT, leadId: LEAD, ruling: "accepted" });

    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
  });

  it("forwards the upstream status rather than hardcoding one", async () => {
    global.fetch = vi.fn().mockImplementation(
      async () =>
        new Response('{"ruling":{}}', { status: 200, headers: { "content-type": "application/json" } })
    );

    const res = await request(buildApp())
      .post("/v1/leads/crm-pairings/rulings")
      .send({ brandId: BRAND, crmContactId: CONTACT, leadId: LEAD, ruling: "accepted" });

    expect(res.status).toBe(200);
  });

  it("forwards a refusal field-for-field under its own status", async () => {
    global.fetch = vi.fn().mockImplementation(
      async () =>
        new Response('{"error":"ruling must be one of accepted, denied","code":"BAD_RULING"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    );

    const res = await request(buildApp())
      .post("/v1/leads/crm-pairings/rulings")
      .send({ brandId: BRAND, crmContactId: CONTACT, leadId: LEAD, ruling: "maybe" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "ruling must be one of accepted, denied", code: "BAD_RULING" });
  });

  it("does not validate the ruling vocabulary here — an unknown verdict still reaches lead-service", async () => {
    await request(buildApp())
      .post("/v1/leads/crm-pairings/rulings")
      .send({ brandId: BRAND, crmContactId: CONTACT, leadId: LEAD, ruling: "a-verdict-shipped-later" });

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body).ruling).toBe("a-verdict-shipped-later");
  });
});

describe("DELETE /v1/leads/crm-pairings/rulings — a human takes the ruling back", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response('{"withdrawn":true,"alreadyWithdrawn":false}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });

  it("forwards to lead-service DELETE /orgs/leads/crm-pairings/rulings with the query verbatim", async () => {
    const query = `?brandId=${BRAND}&crmContactId=${CONTACT}&leadId=${LEAD}&somethingBrandNew=x`;
    const res = await request(buildApp()).delete(`/v1/leads/crm-pairings/rulings${query}`);

    expect(res.status).toBe(200);
    expect(calls[0].url.endsWith(`/orgs/leads/crm-pairings/rulings${query}`)).toBe(true);
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
  });

  it("does not raise its own 400 on a missing parameter — lead-service owns them", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response('{"error":"crmContactId is required"}', {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await request(buildApp()).delete(`/v1/leads/crm-pairings/rulings?brandId=${BRAND}`);

    expect(calls).toHaveLength(1);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "crmContactId is required" });
  });

  it("forwards a 409 nothing_stated with its code intact", async () => {
    global.fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          '{"code":"nothing_stated","error":"nobody has ruled on this pairing, so there is nothing to withdraw"}',
          { status: 409, headers: { "content-type": "application/json" } }
        )
    );

    const res = await request(buildApp()).delete(
      `/v1/leads/crm-pairings/rulings?brandId=${BRAND}&crmContactId=${CONTACT}&leadId=${LEAD}`
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("nothing_stated");
  });
});

describe("the new literals do not shadow the lead routes that were already here", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      calls.push(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  it("GET /v1/leads/:id still reads one lead", async () => {
    await request(buildApp()).get(`/v1/leads/${LEAD}?brandId=${BRAND}`);
    expect(calls[0].endsWith(`/orgs/leads/${LEAD}?brandId=${BRAND}`)).toBe(true);
  });

  it("GET /v1/leads/stats still reaches the aggregate", async () => {
    await request(buildApp()).get(`/v1/leads/stats?brandId=${BRAND}`);
    expect(calls[0].endsWith(`/orgs/stats?brandId=${BRAND}`)).toBe(true);
  });

  it("POST /v1/leads/:id/step-statements is untouched by the new POST literal", async () => {
    await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .send({ step: "meeting_booked" });
    expect(calls[0].endsWith(`/orgs/leads/${LEAD}/step-statements`)).toBe(true);
  });

  it("DELETE /v1/leads/:id/step-statements/:step is untouched by the new DELETE literal", async () => {
    await request(buildApp()).delete(`/v1/leads/${LEAD}/step-statements/meeting_booked`);
    expect(calls[0].endsWith(`/orgs/leads/${LEAD}/step-statements/meeting_booked`)).toBe(true);
  });

  it("GET /v1/leads still lists", async () => {
    await request(buildApp()).get(`/v1/leads?brandId=${BRAND}`);
    expect(calls[0].endsWith(`/orgs/leads?brandId=${BRAND}`)).toBe(true);
  });
});
