import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { CAMPAIGN_BASE } = vi.hoisted(() => {
  const CAMPAIGN_BASE = "http://campaign.test.local";
  process.env.CAMPAIGN_SERVICE_URL = CAMPAIGN_BASE;
  process.env.CAMPAIGN_SERVICE_API_KEY = "campaign-test-key";
  return { CAMPAIGN_BASE };
});

/**
 * POST /v1/campaigns/start-funded-pair — BEHAVIOURAL cover.
 *
 * A source-substring test cannot see what goes over the wire, and everything that matters
 * about this route is on the wire (CLAUDE.md rule #7 corollary 3). Asserted here:
 *
 *  - the start reaches campaign-service's OWN path, /campaigns/start-funded-pair;
 *  - the body arrives BYTE-IDENTICAL, including a field this gateway has never heard of and
 *    one campaign-service means to REFUSE. Its body is `.strict()` on purpose, so a whitelist
 *    here would strip the refusable field and turn a "no" into a different request succeeding;
 *  - the gateway injects no workflow, no name and no budget of its own;
 *  - the started campaign comes back exactly as campaign-service returned it, 201 included —
 *    the status is part of the contract, which is why the route pipes rather than re-emits;
 *  - a refusal reaches the caller with campaign-service's own status, its customer-facing
 *    `error` sentence and its `reason` code, all unchanged, at 400, 409 and 502 alike;
 *  - the org, user and run reaching campaign-service are the AUTHENTICATED ones, never a
 *    caller-supplied override — a customer cannot name whose pair to start;
 *  - and the SIBLING literal routes under /campaigns still reach their own downstream paths,
 *    because `POST /campaigns/start-funded-pair` sits in a file full of `/campaigns/:id` routes.
 *
 * Per CLAUDE.md #6/#8 the payloads are fixtures, not a contract this repo owns.
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_authenticated";
      req.orgId = "org_authenticated";
      req.runId = "run_authenticated";
      req.authType = "user_key";
      next();
    },
  };
});

import campaignRouter from "../../src/routes/campaigns.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "0f5f2b0a-6f34-4f2a-9a0c-2b53a5b9a111";

const VALID_BODY = {
  brandId: BRAND_ID,
  offerId: OFFER_ID,
  featureSlug: "sales-cold-email-outreach",
  legKey: "visit_to_meeting",
};

const CREATED_BODY = {
  campaign: {
    id: "cmp_9f2",
    status: "ongoing",
    brandIds: [BRAND_ID],
    offerId: OFFER_ID,
    featureSlug: "sales-cold-email-outreach",
    legKey: "visit_to_meeting",
    workflowSlug: "sales-email-cold-outreach-sienna-v3",
    name: "Sales cold email outreach — visit_meeting",
  },
  started: true,
  alreadyRunning: false,
  ceilingCents: 2500,
};

type Captured = { url: string; init: any };
let captured: Captured[] = [];

function stubFetch(status: number, body: unknown) {
  captured = [];
  global.fetch = vi.fn(async (url: any, init: any) => {
    captured.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function sentBody(): any {
  return JSON.parse(captured[0].init.body as string);
}

function sentHeaders(): Record<string, string> {
  const raw = captured[0].init.headers as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
}

beforeEach(() => {
  captured = [];
});

describe("POST /v1/campaigns/start-funded-pair", () => {
  it("reaches campaign-service's own path", async () => {
    stubFetch(201, CREATED_BODY);
    await request(buildApp()).post("/v1/campaigns/start-funded-pair").send(VALID_BODY).expect(201);

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`${CAMPAIGN_BASE}/campaigns/start-funded-pair`);
    expect(captured[0].init.method).toBe("POST");
  });

  it("forwards the body byte-identical and adds nothing of its own", async () => {
    stubFetch(201, CREATED_BODY);
    await request(buildApp()).post("/v1/campaigns/start-funded-pair").send(VALID_BODY).expect(201);

    expect(sentBody()).toEqual(VALID_BODY);
    // The three the caller may not state — campaign-service refuses them and the gateway must
    // never supply one on the caller's behalf.
    expect(sentBody()).not.toHaveProperty("workflowSlug");
    expect(sentBody()).not.toHaveProperty("workflowDynastySlug");
    expect(sentBody()).not.toHaveProperty("name");
    expect(sentBody()).not.toHaveProperty("dailyBudgetCents");
    expect(sentBody()).not.toHaveProperty("maxBudgetDailyUsd");
  });

  it("carries the optional legKey through", async () => {
    stubFetch(201, CREATED_BODY);
    const withLeg = { ...VALID_BODY, legKey: "outbound" };
    await request(buildApp()).post("/v1/campaigns/start-funded-pair").send(withLeg).expect(201);

    expect(sentBody()).toEqual(withLeg);
  });

  it("does NOT strip a field campaign-service means to refuse — its .strict() body must see it", async () => {
    // A whitelist here would drop `workflowSlug` and campaign-service would happily start a
    // campaign for a request it was supposed to say no to. Passthrough is what preserves the no.
    stubFetch(400, { error: "A workflow is not yours to choose.", reason: "UNEXPECTED_FIELD" });
    const reachy = { ...VALID_BODY, workflowSlug: "sales-email-cold-outreach-sienna-v3" };
    const res = await request(buildApp())
      .post("/v1/campaigns/start-funded-pair")
      .send(reachy)
      .expect(400);

    expect(sentBody()).toEqual(reachy);
    expect(res.body).toEqual({ error: "A workflow is not yours to choose.", reason: "UNEXPECTED_FIELD" });
  });

  it("returns the started campaign exactly as campaign-service returned it, 201 included", async () => {
    stubFetch(201, CREATED_BODY);
    const res = await request(buildApp())
      .post("/v1/campaigns/start-funded-pair")
      .send(VALID_BODY)
      .expect(201);

    expect(res.body).toEqual(CREATED_BODY);
  });

  it("keeps campaign-service's 200 for a pair whose campaign was already running", async () => {
    const alreadyRunning = { ...CREATED_BODY, started: false, alreadyRunning: true };
    stubFetch(200, alreadyRunning);
    const res = await request(buildApp())
      .post("/v1/campaigns/start-funded-pair")
      .send(VALID_BODY)
      .expect(200);

    expect(res.body).toEqual(alreadyRunning);
  });

  it.each([
    [400, { error: "You haven't funded this channel for that funnel yet.", reason: "PAIR_NOT_FUNDED" }],
    [409, { error: "You funded two legs of this pair, so say which one to start.", reason: "AMBIGUOUS_LEG" }],
    [502, { error: "Nothing can run that channel yet.", reason: "NO_STARTABLE_WORKFLOW" }],
  ])("forwards campaign-service's %i refusal with its sentence and reason intact", async (status, refusal) => {
    stubFetch(status, refusal);
    const res = await request(buildApp())
      .post("/v1/campaigns/start-funded-pair")
      .send(VALID_BODY)
      .expect(status);

    // The dashboard renders `error` verbatim to the customer, and branches on `reason`.
    expect(res.body).toEqual(refusal);
    expect(res.body.error).toBe(refusal.error);
    expect(res.body.reason).toBe(refusal.reason);
  });

  it("sends the AUTHENTICATED identity, never a caller-supplied override", async () => {
    stubFetch(201, CREATED_BODY);
    await request(buildApp())
      .post("/v1/campaigns/start-funded-pair")
      .set("x-org-id", "org_someone_else")
      .set("x-user-id", "user_someone_else")
      .set("x-run-id", "run_someone_else")
      .send(VALID_BODY)
      .expect(201);

    const headers = sentHeaders();
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_authenticated");
    expect(headers["x-run-id"]).toBe("run_authenticated");
  });

  it("does not swallow the sibling literal routes under /campaigns", async () => {
    // `/campaigns/start-funded-pair` lives in a file of `/campaigns/:id` routes. A `:id` route
    // registered ahead of it would send campaign-service `start-funded-pair` as a campaign id.
    stubFetch(200, { stats: {} });
    await request(buildApp()).get("/v1/campaigns/stats").expect(200);
    expect(captured.every((c) => !c.url.includes("/campaigns/start-funded-pair"))).toBe(true);
  });
});
