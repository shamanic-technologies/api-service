/**
 * Regression test: the performance leaderboard had multiple bugs:
 * 1. fetchCombinedDeliveryStats used wrong field names (sent/opened/clicked/replied
 *    instead of emailsSent/emailsOpened/emailsClicked/emailsReplied), so all
 *    delivery stats were always 0.
 * 2. It summed transactional + broadcast stats, but transactional stats are
 *    transactional/test emails via Postmark — only broadcast (Instantly) is relevant.
 * 3. buildLeaderboardData relied on /campaigns/list which only returns ongoing
 *    campaigns, so brands was always empty when all campaigns were stopped.
 * 4. Campaign costs came from campaign-service which only lists ongoing campaigns.
 * 5. Switched to runs-service public leaderboard endpoint with string cost values.
 * 6. Workflows use {category}-{channel}-{audienceType}-{signatureName} naming.
 * 7. Per-workflow email stats via instantly-service POST /stats/grouped
 *    (run-ids-by-workflow → grouped stats), with email-gateway fallback.
 * 8. emailsReplied from instantly-service = positive replies only (lead_interested).
 * 9. Recipients count per workflow from instantly-service.
 *
 * Fix: Use brand-service as source of truth for brands (like dashboard does),
 * use correct field names, only read broadcast stats for brands,
 * use runs-service /v1/stats/public/leaderboard for costs (public, cross-org, string values).
 * Per-workflow email stats via instantly-service POST /stats/grouped.
 * Categories parsed from workflow name format via @distribute/content.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCallExternalService = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  externalServices: {
    client: { url: "http://mock-client", apiKey: "k" },
    emailgen: { url: "http://mock-emailgen", apiKey: "k" },
    emailGateway: { url: "http://mock-email", apiKey: "k" },
    campaign: { url: "http://mock-campaign", apiKey: "k" },
    lead: { url: "http://mock-lead", apiKey: "k" },
    key: { url: "http://mock-key", apiKey: "k" },
    replyQualification: { url: "http://mock-rq", apiKey: "k" },
    scraping: { url: "http://mock-scraping", apiKey: "k" },
    transactionalEmail: { url: "http://mock-transactional-email", apiKey: "k" },
    brand: { url: "http://mock-brand", apiKey: "k" },
    runs: { url: "http://mock-runs", apiKey: "k" },
    instantly: { url: "http://mock-instantly", apiKey: "k" },
  },
}));

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import express from "express";
import request from "supertest";
import performanceRouter from "../../src/routes/performance.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(performanceRouter);
  return app;
}

function makeBroadcastStats(overrides: Partial<Record<string, number>> = {}) {
  return {
    emailsSent: 0, emailsDelivered: 0, emailsOpened: 0,
    emailsClicked: 0, emailsReplied: 0, emailsBounced: 0,
    repliesWillingToMeet: 0, repliesInterested: 0,
    repliesNotInterested: 0, repliesOutOfOffice: 0,
    repliesUnsubscribe: 0, recipients: 0,
    ...overrides,
  };
}

function makeGatewayResponse(broadcast: Record<string, number> | null) {
  return {
    transactional: makeBroadcastStats({ emailsSent: 100, emailsOpened: 50 }),
    broadcast: broadcast ? makeBroadcastStats(broadcast) : null,
  };
}

function makeGroupedGatewayResponse(groups: Array<{ key: string; broadcast: Record<string, number> }>) {
  return {
    groups: groups.map((g) => ({
      key: g.key,
      broadcast: makeBroadcastStats(g.broadcast),
    })),
  };
}

function makeInstantlyStats(overrides: Partial<Record<string, number>> = {}) {
  return {
    emailsSent: 0, emailsDelivered: 0, emailsOpened: 0,
    emailsClicked: 0, emailsReplied: 0, emailsBounced: 0,
    repliesAutoReply: 0, repliesNotInterested: 0,
    repliesOutOfOffice: 0, repliesUnsubscribe: 0,
    ...overrides,
  };
}

function makeInstantlyGroupedResponse(groups: Array<{ key: string; stats: Record<string, number>; recipients: number }>) {
  return {
    groups: groups.map((g) => ({
      key: g.key,
      stats: makeInstantlyStats(g.stats),
      recipients: g.recipients,
    })),
  };
}

/** Runs-service public leaderboard returns costs as strings */
interface MockRunsGroup {
  dimensions: Record<string, string>;
  totalCostInUsdCents: string;
  actualCostInUsdCents: string;
  provisionedCostInUsdCents: string;
  cancelledCostInUsdCents: string;
  runCount: number;
}

/** Helper: set up mocks for brand-service + runs-service + instantly-service */
function setupMocks(
  brands: Array<{ id: string; domain: string | null; name: string | null; brandUrl: string | null }>,
  brandCostGroups: MockRunsGroup[] = [],
  workflowGroups: MockRunsGroup[] = [],
  runIdsByWorkflow: Record<string, string[]> = {},
  instantlyGroups: Array<{ key: string; stats: Record<string, number>; recipients: number }> = [],
) {
  return (_service: any, path: string, _opts: any) => {
    // Brand-service: /org-ids
    if (path === "/org-ids") {
      return Promise.resolve({ organization_ids: ["org-1"] });
    }
    // Brand-service: /brands?orgId=...
    if (path.startsWith("/brands?orgId=")) {
      return Promise.resolve({ brands });
    }
    // Runs-service: /v1/stats/public/leaderboard
    if (path.startsWith("/v1/stats/public/leaderboard")) {
      if (path.includes("groupBy=brandId")) {
        return Promise.resolve({ groups: brandCostGroups });
      }
      if (path.includes("groupBy=workflowName")) {
        return Promise.resolve({ groups: workflowGroups });
      }
      return Promise.resolve({ groups: [] });
    }
    // Runs-service: /v1/stats/run-ids-by-workflow
    if (path.startsWith("/v1/stats/run-ids-by-workflow")) {
      return Promise.resolve({ groups: runIdsByWorkflow });
    }
    // Instantly-service: /stats/grouped
    if (path === "/stats/grouped") {
      return Promise.resolve(makeInstantlyGroupedResponse(instantlyGroups));
    }
    return null; // Will be handled by per-test overrides
  };
}

describe("GET /performance/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return brands from brand-service with per-workflow stats from instantly-service", async () => {
    const app = createApp();
    const brands = [
      { id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" },
      { id: "brand-2", domain: "widgets.com", name: "Widgets", brandUrl: "https://widgets.com" },
    ];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "5000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "1000.0000", cancelledCostInUsdCents: "0", runCount: 10 },
      { dimensions: { workflowName: "sales-email-cold-outreach-darmstadt" }, totalCostInUsdCents: "3000.0000", actualCostInUsdCents: "2000.0000", provisionedCostInUsdCents: "1000.0000", cancelledCostInUsdCents: "0", runCount: 5 },
    ];
    const runIdsByWorkflow = {
      "sales-email-cold-outreach-sienna": ["run-1", "run-2"],
      "sales-email-cold-outreach-darmstadt": ["run-3"],
    };
    const instantlyGroups = [
      { key: "sales-email-cold-outreach-sienna", stats: { emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5 }, recipients: 25 },
      { key: "sales-email-cold-outreach-darmstadt", stats: { emailsSent: 20, emailsOpened: 10, emailsClicked: 2, emailsReplied: 3 }, recipients: 18 },
    ];

    const mock = setupMocks(brands, [], workflowGroups, runIdsByWorkflow, instantlyGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;

      // Email-gateway stats for brands
      if (path === "/stats") {
        const body = opts?.body || {};
        if (body.brandId === "brand-1") {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5 }));
        }
        if (body.brandId === "brand-2") {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 20, emailsOpened: 10, emailsClicked: 2, emailsReplied: 3 }));
        }
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    // Brands should come from brand-service
    expect(res.body.brands).toHaveLength(2);

    const brand1 = res.body.brands.find((b: any) => b.brandId === "brand-1");
    expect(brand1).toBeDefined();
    expect(brand1.brandDomain).toBe("acme.com");
    expect(brand1.emailsSent).toBe(30);
    expect(brand1.emailsOpened).toBe(15);
    expect(brand1.emailsReplied).toBe(5);

    const brand2 = res.body.brands.find((b: any) => b.brandId === "brand-2");
    expect(brand2).toBeDefined();
    expect(brand2.emailsSent).toBe(20);

    // Workflows should have stats from instantly-service
    expect(res.body.workflows).toHaveLength(2);
    const siennaWf = res.body.workflows.find((w: any) => w.workflowName === "sales-email-cold-outreach-sienna");
    expect(siennaWf).toBeDefined();
    expect(siennaWf.totalCostUsdCents).toBe(4000);
    expect(siennaWf.runCount).toBe(10);
    expect(siennaWf.emailsSent).toBe(30);
    expect(siennaWf.emailsOpened).toBe(15);
    // emailsReplied = positive replies only from instantly
    expect(siennaWf.emailsReplied).toBe(5);
    // repliesInterested = emailsReplied (same value, since emailsReplied IS positive replies)
    expect(siennaWf.repliesInterested).toBe(5);
    expect(siennaWf.recipients).toBe(25);
    expect(siennaWf.interestedRate).toBeGreaterThan(0);

    // Category/signature parsing
    expect(siennaWf.category).toBe("sales");
    expect(siennaWf.displayName).toBe("Sienna");
    expect(siennaWf.signatureName).toBe("sienna");
    expect(siennaWf.sectionKey).toBe("sales-email-cold-outreach");

    const darmstadtWf = res.body.workflows.find((w: any) => w.workflowName === "sales-email-cold-outreach-darmstadt");
    expect(darmstadtWf).toBeDefined();
    expect(darmstadtWf.emailsSent).toBe(20);
    expect(darmstadtWf.emailsReplied).toBe(3);
    expect(darmstadtWf.repliesInterested).toBe(3);
    expect(darmstadtWf.recipients).toBe(18);

    // availableCategories
    expect(res.body.availableCategories).toContain("sales");
  });

  it("should ignore transactional stats entirely (brand-level)", async () => {
    const app = createApp();
    const brands = [{ id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" }];

    const mock = setupMocks(brands);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;

      if (path === "/stats") {
        return Promise.resolve({
          transactional: makeBroadcastStats({ emailsSent: 500, emailsOpened: 300 }),
          broadcast: makeBroadcastStats({ emailsSent: 10, emailsOpened: 5, emailsClicked: 1, emailsReplied: 2 }),
        });
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    const brand = res.body.brands[0];
    expect(brand.emailsSent).toBe(10);
    expect(brand.emailsOpened).toBe(5);
    expect(brand.emailsReplied).toBe(2);
    expect(brand.emailsSent).not.toBe(500);
    expect(brand.emailsSent).not.toBe(510);
  });

  it("should return zeros when broadcast is null", async () => {
    const app = createApp();
    const brands = [{ id: "brand-1", domain: "a.com", name: null, brandUrl: "https://a.com" }];
    // Brand needs cost so it passes the inactive filter
    const brandCostGroups: MockRunsGroup[] = [
      { dimensions: { brandId: "brand-1" }, totalCostInUsdCents: "100.0000", actualCostInUsdCents: "100.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 1 },
    ];

    const mock = setupMocks(brands, brandCostGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;

      if (path === "/stats") {
        return Promise.resolve({
          transactional: makeBroadcastStats({ emailsSent: 100, emailsOpened: 50 }),
          broadcast: null,
        });
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    const brand = res.body.brands[0];
    expect(brand.emailsSent).toBe(0);
    expect(brand.emailsOpened).toBe(0);
    expect(brand.emailsReplied).toBe(0);
  });

  it("should parseFloat string cost values from runs-service public leaderboard", async () => {
    const app = createApp();
    const brands = [{ id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" }];
    const brandCostGroups: MockRunsGroup[] = [
      { dimensions: { brandId: "brand-1" }, totalCostInUsdCents: "10000.5000000000", actualCostInUsdCents: "8000.3000000000", provisionedCostInUsdCents: "2000.2000000000", cancelledCostInUsdCents: "0", runCount: 5 },
    ];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-phoenix" }, totalCostInUsdCents: "10000.5000000000", actualCostInUsdCents: "8000.3000000000", provisionedCostInUsdCents: "2000.2000000000", cancelledCostInUsdCents: "0", runCount: 5 },
    ];
    const runIdsByWorkflow = {
      "sales-email-cold-outreach-phoenix": ["run-1"],
    };
    const instantlyGroups = [
      { key: "sales-email-cold-outreach-phoenix", stats: { emailsSent: 10, emailsOpened: 5, emailsClicked: 1, emailsReplied: 2 }, recipients: 8 },
    ];

    const mock = setupMocks(brands, brandCostGroups, workflowGroups, runIdsByWorkflow, instantlyGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;

      if (path === "/stats") {
        return Promise.resolve(makeGatewayResponse({ emailsSent: 10, emailsOpened: 5, emailsClicked: 1, emailsReplied: 2 }));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    const brand = res.body.brands[0];
    // parseFloat("8000.3000000000") → 8000.3, Math.round → 8000
    expect(brand.totalCostUsdCents).toBe(8000);

    const wf = res.body.workflows[0];
    expect(wf.totalCostUsdCents).toBe(8000);
    expect(wf.workflowName).toBe("sales-email-cold-outreach-phoenix");
    expect(wf.runCount).toBe(5);
    expect(wf.category).toBe("sales");
    expect(wf.signatureName).toBe("phoenix");
    expect(wf.displayName).toBe("Phoenix");
  });

  it("should keep workflows with empty workflowName as 'unknown'", async () => {
    const app = createApp();
    const brands = [{ id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" }];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "5000.0000", actualCostInUsdCents: "5000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 10 },
      { dimensions: { workflowName: "" }, totalCostInUsdCents: "9000.0000", actualCostInUsdCents: "9000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 100 },
    ];
    const runIdsByWorkflow = {
      "sales-email-cold-outreach-sienna": ["run-1"],
    };
    const instantlyGroups = [
      { key: "sales-email-cold-outreach-sienna", stats: { emailsSent: 10, emailsOpened: 5, emailsReplied: 2 }, recipients: 8 },
    ];

    const mock = setupMocks(brands, [], workflowGroups, runIdsByWorkflow, instantlyGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    expect(res.body.workflows).toHaveLength(2);
    const sienna = res.body.workflows.find((w: any) => w.workflowName === "sales-email-cold-outreach-sienna");
    expect(sienna).toBeDefined();
    expect(sienna.signatureName).toBe("sienna");
    const unknown = res.body.workflows.find((w: any) => w.workflowName === "unknown");
    expect(unknown).toBeDefined();
    expect(unknown.displayName).toBe("Unknown");
    expect(unknown.category).toBeNull();
    expect(unknown.signatureName).toBeNull();
  });

  it("should return categorySections with stats from instantly-service", async () => {
    const app = createApp();
    const brands = [
      { id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" },
    ];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "4000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 10 },
      { dimensions: { workflowName: "sales-email-cold-outreach-darmstadt" }, totalCostInUsdCents: "2000.0000", actualCostInUsdCents: "2000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 5 },
    ];
    const runIdsByWorkflow = {
      "sales-email-cold-outreach-sienna": ["run-1", "run-2"],
      "sales-email-cold-outreach-darmstadt": ["run-3"],
    };
    const instantlyGroups = [
      { key: "sales-email-cold-outreach-sienna", stats: { emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5 }, recipients: 25 },
      { key: "sales-email-cold-outreach-darmstadt", stats: { emailsSent: 20, emailsOpened: 10, emailsClicked: 2, emailsReplied: 3 }, recipients: 18 },
    ];

    const mock = setupMocks(brands, [], workflowGroups, runIdsByWorkflow, instantlyGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        const body = opts?.body || {};
        if (body.brandId) {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 50, emailsOpened: 25, emailsClicked: 5, emailsReplied: 8 }));
        }
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    expect(res.body.categorySections).toBeDefined();
    // Both workflows share the same sectionKey "sales-email-cold-outreach"
    expect(res.body.categorySections.length).toBe(1);

    const section = res.body.categorySections[0];
    expect(section.sectionKey).toBe("sales-email-cold-outreach");
    expect(section.label).toBe("Sales Cold Email Outreach");
    expect(section.category).toBe("sales");
    expect(section.workflows).toHaveLength(2);
    expect(section.stats.totalCostUsdCents).toBe(6000); // 4000 + 2000
    expect(section.stats.emailsSent).toBe(50); // 30 + 20
    expect(section.stats.emailsReplied).toBe(8); // 5 + 3
    // repliesInterested = emailsReplied for instantly-service data
    expect(section.stats.repliesInterested).toBe(8); // 5 + 3
    expect(section.stats.recipients).toBe(43); // 25 + 18
    expect(section.stats.interestedRate).toBeGreaterThan(0);

    // Workflows should have signatureName
    const sienna = section.workflows.find((w: any) => w.workflowName === "sales-email-cold-outreach-sienna");
    expect(sienna).toBeDefined();
    expect(sienna.signatureName).toBe("sienna");
    expect(sienna.displayName).toBe("Sienna");
    expect(sienna.repliesInterested).toBe(5);
    expect(sienna.recipients).toBe(25);

    const darmstadt = section.workflows.find((w: any) => w.workflowName === "sales-email-cold-outreach-darmstadt");
    expect(darmstadt).toBeDefined();
    expect(darmstadt.repliesInterested).toBe(3);
    expect(darmstadt.recipients).toBe(18);

    // Brands included in the section
    expect(section.brands).toHaveLength(1);
  });

  it("should fall back to email-gateway when instantly-service returns empty, then proportional", async () => {
    const app = createApp();
    const brands = [
      { id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" },
    ];
    // Two workflows with different costs — proportional distribution should split by cost share
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "6000.0000", actualCostInUsdCents: "6000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 30 },
      { dimensions: { workflowName: "sales-email-cold-outreach-darmstadt" }, totalCostInUsdCents: "4000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 20 },
    ];

    // Empty instantly response — no run IDs found
    const mock = setupMocks(brands, [], workflowGroups, {}, []);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        const body = opts?.body || {};
        // email-gateway groupBy also returns empty — simulates old emails without workflowName
        if (body.groupBy === "workflowName") {
          return Promise.resolve({ groups: [] });
        }
        // Per-brand stats
        if (body.brandId) {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 100, emailsOpened: 50, emailsClicked: 10, emailsReplied: 8 }));
        }
        // Aggregate stats (fallback)
        return Promise.resolve(makeGatewayResponse({
          emailsSent: 100, emailsOpened: 50, emailsClicked: 10, emailsReplied: 8,
          repliesWillingToMeet: 3, repliesInterested: 2,
        }));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    // Workflows should get proportional stats based on cost share (60% / 40%)
    const sienna = res.body.workflows.find((w: any) => w.workflowName === "sales-email-cold-outreach-sienna");
    expect(sienna).toBeDefined();
    expect(sienna.emailsSent).toBe(60); // 100 * 0.6
    expect(sienna.emailsOpened).toBe(30); // 50 * 0.6
    expect(sienna.emailsReplied).toBe(5); // Math.round(8 * 0.6)
    expect(sienna.repliesInterested).toBe(3); // Math.round(5 * 0.6)
    expect(sienna.openRate).toBeGreaterThan(0);
    expect(sienna.replyRate).toBeGreaterThan(0);
    expect(sienna.interestedRate).toBeGreaterThan(0);

    const darmstadt = res.body.workflows.find((w: any) => w.workflowName === "sales-email-cold-outreach-darmstadt");
    expect(darmstadt).toBeDefined();
    expect(darmstadt.emailsSent).toBe(40); // 100 * 0.4
    expect(darmstadt.emailsOpened).toBe(20); // 50 * 0.4
    expect(darmstadt.emailsReplied).toBe(3); // Math.round(8 * 0.4)
    expect(darmstadt.repliesInterested).toBe(2); // Math.round(5 * 0.4)

    // Category sections should also have stats from the fallback
    expect(res.body.categorySections.length).toBe(1);
    expect(res.body.categorySections[0].stats.emailsSent).toBe(100); // 60 + 40
  });

  it("should fall back to email-gateway groupBy when instantly-service returns empty", async () => {
    const app = createApp();
    const brands = [
      { id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" },
    ];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "4000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 10 },
    ];

    // Empty instantly response — no run IDs
    const mock = setupMocks(brands, [], workflowGroups, {}, []);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        const body = opts?.body || {};
        // email-gateway groupBy returns data (fallback 1)
        if (body.groupBy === "workflowName") {
          return Promise.resolve(makeGroupedGatewayResponse([
            { key: "sales-email-cold-outreach-sienna", broadcast: { emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5, repliesWillingToMeet: 2, repliesInterested: 1 } },
          ]));
        }
        if (body.brandId) {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5 }));
        }
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    const sienna = res.body.workflows.find((w: any) => w.workflowName === "sales-email-cold-outreach-sienna");
    expect(sienna).toBeDefined();
    // Stats from email-gateway fallback
    expect(sienna.emailsSent).toBe(30);
    expect(sienna.emailsOpened).toBe(15);
    expect(sienna.emailsReplied).toBe(5);
    // repliesInterested from email-gateway = willingToMeet + interested
    expect(sienna.repliesInterested).toBe(3); // 2 + 1
    // recipients not set from email-gateway fallback
    expect(sienna.recipients).toBe(0);
  });

  it("should filter out brands with no cost and no email activity", async () => {
    const app = createApp();
    const brands = [
      { id: "active-brand", domain: "active.com", name: "Active", brandUrl: "https://active.com" },
      { id: "inactive-brand", domain: "inactive.com", name: "Inactive", brandUrl: "https://inactive.com" },
      { id: "cost-only-brand", domain: "costonly.com", name: "CostOnly", brandUrl: "https://costonly.com" },
    ];
    const brandCostGroups: MockRunsGroup[] = [
      { dimensions: { brandId: "active-brand" }, totalCostInUsdCents: "500.0000", actualCostInUsdCents: "500.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 3 },
      { dimensions: { brandId: "cost-only-brand" }, totalCostInUsdCents: "200.0000", actualCostInUsdCents: "200.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 1 },
      // inactive-brand has no cost entry
    ];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "700.0000", actualCostInUsdCents: "700.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 4 },
    ];
    const runIdsByWorkflow = {
      "sales-email-cold-outreach-sienna": ["run-1"],
    };
    const instantlyGroups = [
      { key: "sales-email-cold-outreach-sienna", stats: { emailsSent: 10, emailsOpened: 5, emailsClicked: 1, emailsReplied: 1 }, recipients: 8 },
    ];

    const mock = setupMocks(brands, brandCostGroups, workflowGroups, runIdsByWorkflow, instantlyGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        const body = opts?.body || {};
        if (body.brandId === "active-brand") {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 10, emailsOpened: 5, emailsClicked: 1, emailsReplied: 1 }));
        }
        // inactive-brand and cost-only-brand: no email stats
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");
    expect(res.status).toBe(200);

    // inactive-brand has no cost AND no email stats → filtered out
    // cost-only-brand has cost but no email stats → kept (has activity via cost)
    // active-brand has both → kept
    expect(res.body.brands).toHaveLength(2);
    expect(res.body.brands.map((b: any) => b.brandId)).toContain("active-brand");
    expect(res.body.brands.map((b: any) => b.brandId)).toContain("cost-only-brand");
    expect(res.body.brands.map((b: any) => b.brandId)).not.toContain("inactive-brand");

    // Section brands should also be filtered
    expect(res.body.categorySections[0].brands).toHaveLength(2);
  });

  it("should return hero stats with best $/open and $/reply by brand", async () => {
    const app = createApp();
    const brands = [
      { id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" },
      { id: "brand-2", domain: "widgets.com", name: "Widgets", brandUrl: "https://widgets.com" },
    ];
    const brandCostGroups: MockRunsGroup[] = [
      { dimensions: { brandId: "brand-1" }, totalCostInUsdCents: "500.0000", actualCostInUsdCents: "500.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 3 },
      { dimensions: { brandId: "brand-2" }, totalCostInUsdCents: "800.0000", actualCostInUsdCents: "800.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 5 },
    ];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "1300.0000", actualCostInUsdCents: "1300.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 8 },
    ];
    const runIdsByWorkflow = {
      "sales-email-cold-outreach-sienna": ["run-1"],
    };
    const instantlyGroups = [
      { key: "sales-email-cold-outreach-sienna", stats: { emailsSent: 50, emailsOpened: 25, emailsClicked: 5, emailsReplied: 8 }, recipients: 40 },
    ];

    const mock = setupMocks(brands, brandCostGroups, workflowGroups, runIdsByWorkflow, instantlyGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        const body = opts?.body || {};
        // brand-1: 20 sent, 10 opened, 4 replied → costPerOpen=500/10=50, costPerReply=500/4=125
        if (body.brandId === "brand-1") {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 20, emailsOpened: 10, emailsClicked: 2, emailsReplied: 4 }));
        }
        // brand-2: 30 sent, 15 opened, 3 replied → costPerOpen=800/15≈53, costPerReply=800/3≈267
        if (body.brandId === "brand-2") {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 3 }));
        }
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");
    expect(res.status).toBe(200);
    expect(res.body.hero).toBeDefined();

    // Best $/open: brand-1 has 50 cents/open vs brand-2 has ~53 → brand-1 wins
    expect(res.body.hero.bestCostPerOpen).toBeDefined();
    expect(res.body.hero.bestCostPerOpen.brandDomain).toBe("acme.com");
    expect(res.body.hero.bestCostPerOpen.costPerOpenCents).toBe(50);

    // Best $/reply: brand-1 has 125 cents/reply vs brand-2 has ~267 → brand-1 wins
    expect(res.body.hero.bestCostPerReply).toBeDefined();
    expect(res.body.hero.bestCostPerReply.brandDomain).toBe("acme.com");
    expect(res.body.hero.bestCostPerReply.costPerReplyCents).toBe(125);
  });

  it("should work without appId filter — falls back to email-gateway for workflows", async () => {
    const app = createApp();
    const brands = [
      { id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" },
    ];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "5000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "1000.0000", cancelledCostInUsdCents: "0", runCount: 10 },
    ];
    const brandCostGroups: MockRunsGroup[] = [
      { dimensions: { brandId: "brand-1" }, totalCostInUsdCents: "5000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "1000.0000", cancelledCostInUsdCents: "0", runCount: 10 },
    ];

    // No appId → fetchRunIdsByWorkflow skips (requires appId) → falls back to email-gateway
    const mock = setupMocks(brands, brandCostGroups, workflowGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;

      if (path === "/stats") {
        const body = opts?.body || {};
        if (body.groupBy === "workflowName") {
          // Without appId filter, appId should NOT be in the body
          expect(body.appId).toBeUndefined();
          return Promise.resolve(makeGroupedGatewayResponse([
            { key: "sales-email-cold-outreach-sienna", broadcast: { emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5, repliesWillingToMeet: 2, repliesInterested: 1 } },
          ]));
        }
        if (body.brandId) {
          expect(body.appId).toBeUndefined();
          return Promise.resolve(makeGatewayResponse({ emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5 }));
        }
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    // No appId query param
    const res = await request(app).get("/performance/leaderboard");

    expect(res.status).toBe(200);
    expect(res.body.brands).toHaveLength(1);
    expect(res.body.workflows).toHaveLength(1);
    // Falls back to email-gateway since no appId → no run-ids-by-workflow call
    expect(res.body.workflows[0].emailsSent).toBe(30);

    // Verify runs-service was called WITHOUT appId in the URL
    const runsCall = mockCallExternalService.mock.calls.find(
      (call: any[]) => typeof call[1] === "string" && call[1].includes("/v1/stats/public/leaderboard")
    );
    expect(runsCall).toBeDefined();
    expect(runsCall![1]).not.toContain("appId=");
  });

  it("should return null category for non-standard workflow names", async () => {
    const app = createApp();
    const brands = [{ id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" }];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "unknown-workflow-v1" }, totalCostInUsdCents: "1000.0000", actualCostInUsdCents: "1000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 2 },
    ];

    const mock = setupMocks(brands, [], workflowGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        const body = opts?.body || {};
        if (body.groupBy === "workflowName") {
          return Promise.resolve({ groups: [] });
        }
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);
    const wf = res.body.workflows[0];
    expect(wf.category).toBeNull();
    expect(wf.sectionKey).toBeNull();
    expect(wf.signatureName).toBeNull();
    expect(wf.displayName).toBe("Unknown Workflow V1"); // fallback title-case
    // Non-standard workflows should not appear in availableCategories or sections
    expect(res.body.availableCategories).toHaveLength(0);
    expect(res.body.categorySections).toHaveLength(0);
  });

  it("should pass correct runIds to instantly-service grouped stats", async () => {
    const app = createApp();
    const brands = [{ id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" }];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "4000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "0", cancelledCostInUsdCents: "0", runCount: 10 },
    ];
    const runIdsByWorkflow = {
      "sales-email-cold-outreach-sienna": ["run-1", "run-2", "run-3"],
    };
    const instantlyGroups = [
      { key: "sales-email-cold-outreach-sienna", stats: { emailsSent: 100, emailsOpened: 50, emailsClicked: 10, emailsReplied: 8 }, recipients: 80 },
    ];

    const mock = setupMocks(brands, [], workflowGroups, runIdsByWorkflow, instantlyGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/performance/leaderboard?appId=distribute");

    expect(res.status).toBe(200);

    // Verify instantly-service /stats/grouped was called with correct body
    const instantlyCall = mockCallExternalService.mock.calls.find(
      (call: any[]) => typeof call[1] === "string" && call[1] === "/stats/grouped"
    );
    expect(instantlyCall).toBeDefined();
    expect(instantlyCall![2].body.groups["sales-email-cold-outreach-sienna"].runIds).toEqual(["run-1", "run-2", "run-3"]);

    // Verify workflow stats from instantly
    const wf = res.body.workflows[0];
    expect(wf.emailsSent).toBe(100);
    expect(wf.emailsOpened).toBe(50);
    expect(wf.emailsReplied).toBe(8);
    expect(wf.repliesInterested).toBe(8);
    expect(wf.recipients).toBe(80);
    expect(wf.costPerReplyCents).toBe(500); // 4000 / 8
  });
});

describe("Regression: performance leaderboard must require auth but NOT filter by org/user", () => {
  it("source code should use authenticate middleware only (no requireOrg/requireUser)", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/routes/performance.ts"),
      "utf-8"
    );

    // Must authenticate callers
    expect(content).toContain('from "../middleware/auth.js"');
    // Leaderboard is a global view — org/user headers are for auth only, never for filtering
    expect(content).not.toMatch(/leaderboard.*requireOrg/);
    expect(content).not.toMatch(/leaderboard.*requireUser/);
    // appId should NOT be required
    expect(content).not.toContain('"appId query parameter is required"');
  });

  it("should return identical data regardless of org/user auth context", async () => {
    const app = createApp();
    const brands = [
      { id: "brand-1", domain: "acme.com", name: "Acme", brandUrl: "https://acme.com" },
    ];
    const workflowGroups: MockRunsGroup[] = [
      { dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "5000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "1000.0000", cancelledCostInUsdCents: "0", runCount: 10 },
    ];
    const brandCostGroups: MockRunsGroup[] = [
      { dimensions: { brandId: "brand-1" }, totalCostInUsdCents: "5000.0000", actualCostInUsdCents: "4000.0000", provisionedCostInUsdCents: "1000.0000", cancelledCostInUsdCents: "0", runCount: 10 },
    ];

    // No appId → falls back to email-gateway for workflows
    const mock = setupMocks(brands, brandCostGroups, workflowGroups);
    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      const result = mock(_service, path, opts);
      if (result !== null) return result;
      if (path === "/stats") {
        const body = opts?.body || {};
        if (body.groupBy === "workflowName") {
          return Promise.resolve(makeGroupedGatewayResponse([
            { key: "sales-email-cold-outreach-sienna", broadcast: { emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5 } },
          ]));
        }
        if (body.brandId) {
          return Promise.resolve(makeGatewayResponse({ emailsSent: 30, emailsOpened: 15, emailsClicked: 3, emailsReplied: 5 }));
        }
        return Promise.resolve(makeGatewayResponse(null));
      }
      return Promise.resolve(null);
    });

    // Call without org/user context
    const res1 = await request(app).get("/performance/leaderboard");
    // Call with org/user context (simulated via headers — auth is mocked)
    const res2 = await request(app)
      .get("/performance/leaderboard")
      .set("x-org-id", "org-123")
      .set("x-user-id", "user-456");

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Data must be identical — org/user headers must never affect leaderboard results
    expect(res1.body.brands).toEqual(res2.body.brands);
    expect(res1.body.workflows).toEqual(res2.body.workflows);
    expect(res1.body.hero).toEqual(res2.body.hero);
  });
});

describe("Regression: performance leaderboard must use broadcast-only stats", () => {
  it("source code should only read broadcast stats for brands, not combine transactional + broadcast", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/routes/performance.ts"),
      "utf-8"
    );

    expect(content).toContain("fetchBroadcastDeliveryStats");
    expect(content).not.toContain("fetchCombinedDeliveryStats");
    expect(content).toContain("b.emailsSent");
    expect(content).toContain("b.emailsOpened");
    expect(content).toContain("b.emailsClicked");
    expect(content).toContain("b.emailsReplied");
    expect(content).not.toMatch(/[bt]\.sent\b/);
    expect(content).not.toMatch(/[bt]\.opened\b/);
    expect(content).not.toMatch(/[bt]\.clicked\b/);
    expect(content).not.toMatch(/[bt]\.replied\b/);
  });

  it("should use instantly-service for per-workflow stats with email-gateway fallback", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/routes/performance.ts"),
      "utf-8"
    );

    // Instantly-service integration
    expect(content).toContain("fetchRunIdsByWorkflow");
    expect(content).toContain("fetchInstantlyGroupedStats");
    expect(content).toContain("/stats/grouped");
    expect(content).toContain("/v1/stats/run-ids-by-workflow");
    // Email-gateway fallback still exists
    expect(content).toContain("fetchWorkflowDeliveryStats");
    expect(content).toContain('groupBy: "workflowName"');
    expect(content).toContain("anyWorkflowEnriched");
  });

  it("should use brand-service and runs-service public leaderboard", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/routes/performance.ts"),
      "utf-8"
    );

    expect(content).toContain("fetchAllBrands");
    expect(content).toContain("/org-ids");
    expect(content).toContain("/brands?orgId=");
    expect(content).toContain("/v1/stats/public/leaderboard");
    expect(content).toContain("parseFloat");
  });

  it("should use workflow name parsing from shared content", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/routes/performance.ts"),
      "utf-8"
    );

    expect(content).toContain("getWorkflowCategory");
    expect(content).toContain("getWorkflowDisplayName");
    expect(content).toContain("getSectionKey");
    expect(content).toContain("getSignatureName");
    expect(content).toContain("SECTION_LABELS");
    expect(content).toContain("@distribute/content");
    expect(content).toContain("availableCategories");
  });

  it("should filter inactive brands before building sections", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/routes/performance.ts"),
      "utf-8"
    );

    expect(content).toContain("b.totalCostUsdCents > 0 || b.emailsSent > 0");
  });

  it("should include reply qualification stats and recipients", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/routes/performance.ts"),
      "utf-8"
    );

    expect(content).toContain("repliesInterested");
    expect(content).toContain("interestedRate");
    expect(content).toContain("recipients");
    // emailsReplied IS positive replies in instantly-service
    expect(content).toContain("emailsReplied IS positive replies");
  });
});
