/**
 * SECURITY hotfix 2026-10-12: generation rows carry our prompt, raw model output, raw
 * variables, token counts, model, prompt type and run costs. A non-staff caller must
 * receive only the customer allowlist (src/lib/customer-email-view.ts) from every route
 * that reads generations, and the platform-wide prompt routes are staff-only.
 *
 * Driven over the wire with the REAL authenticatePlatform + requireStaff; only
 * `authenticate` is stubbed (it resolves identities over the network): it reports
 * `authType: "admin"` when X-API-Key is sent, as the real one does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { PLATFORM_KEY } = vi.hoisted(() => {
  const PLATFORM_KEY = "platform-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = PLATFORM_KEY;
  return { PLATFORM_KEY };
});

const mockCallExternalService = vi.fn();
const mockGetRunsBatch = vi.fn();

vi.mock("../../src/lib/service-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/service-client.js")>();
  return {
    ...actual,
    callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  };
});

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: (...args: unknown[]) => mockGetRunsBatch(...args),
}));

vi.mock("../../src/lib/internal-headers.js", () => ({
  buildInternalHeaders: () => ({}),
}));

vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/middleware/auth.js")>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.authType = req.headers["x-api-key"] ? "admin" : "user_key";
      req.userId = "user-1";
      req.orgId = "org-1";
      req.runId = "run-1";
      next();
    },
    requireOrg: (_req: any, _res: any, next: any) => next(),
    requireUser: (_req: any, _res: any, next: any) => next(),
  };
});

import emailsRouter from "../../src/routes/emails.js";
import campaignsRouter from "../../src/routes/campaigns.js";
import promptsRouter from "../../src/routes/prompts.js";
import contentRouter from "../../src/routes/content.js";
import { CUSTOMER_EMAIL_FIELDS, CUSTOMER_SEQUENCE_STEP_FIELDS } from "../../src/lib/customer-email-view.js";

const FORBIDDEN_KEYS = [
  "promptRaw",
  "responseRaw",
  "variablesRaw",
  "tokensInput",
  "tokensOutput",
  "model",
  "promptType",
  "generationRun",
  "generationRunId",
  "runId",
  "workflowSlug",
  "featureSlug",
  "idempotencyKey",
  "apolloEnrichmentId",
  "orgId",
  "clientCompanyDescription",
  "costs",
  "totalCostInUsdCents",
  "futureInternalField",
];

const GENERATION_ROW = {
  id: "gen-1",
  orgId: "org-1",
  runId: "run-x",
  apolloEnrichmentId: "ae-1",
  promptType: "cold-email-v9",
  leadFirstName: "Ada",
  leadLastName: "Lovelace",
  leadCompany: "Analytical",
  leadTitle: "CTO",
  leadIndustry: "software",
  leadOrganizationDomain: "analytical.io",
  clientCompanyName: "Acme",
  clientCompanyDescription: "internal brand intel",
  variablesRaw: { secret: "variables" },
  brandIds: ["brand-1"],
  campaignId: "camp-1",
  generationRunId: "genrun-1",
  subject: "Hello Ada",
  bodyHtml: "<p>Hi</p>",
  bodyText: "Hi",
  bodySource: "sequence",
  sequence: [
    { step: 1, bodyHtml: "<p>Hi</p>", bodyText: "Hi", daysSinceLastStep: 0, promptRaw: "step prompt" },
    { step: 2, bodyHtml: "<p>Again</p>", bodyText: "Again", daysSinceLastStep: 3 },
  ],
  model: "claude-sonnet-4-6",
  tokensInput: 1200,
  tokensOutput: 300,
  promptRaw: "OUR SECRET PROMPT TEMPLATE",
  responseRaw: { raw: "model output" },
  workflowSlug: "wf-1",
  featureSlug: "feat-1",
  leadId: "lead-1",
  idempotencyKey: "idem-1",
  futureInternalField: "must not leak by default",
  createdAt: "2026-10-12T00:00:00Z",
};

const RUN = {
  status: "completed",
  startedAt: "2026-10-12T00:00:00Z",
  completedAt: "2026-10-12T00:00:01Z",
  totalCostInUsdCents: "1.5",
  costs: [{ costName: "x", totalCostInUsdCents: "1.5" }],
  serviceName: "content-generation-service",
  taskName: "generate",
  descendantRuns: [],
};

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", emailsRouter);
  a.use("/v1", campaignsRouter);
  a.use("/v1", promptsRouter);
  a.use("/v1", contentRouter);
  return a;
}

/** Every key at every depth of a JSON value. */
function allKeys(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, acc));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

function expectCustomerShape(email: Record<string, unknown>) {
  expect(Object.keys(email).every((k) => (CUSTOMER_EMAIL_FIELDS as readonly string[]).includes(k))).toBe(true);
  for (const step of email.sequence as Array<Record<string, unknown>>) {
    expect(Object.keys(step).every((k) => (CUSTOMER_SEQUENCE_STEP_FIELDS as readonly string[]).includes(k))).toBe(true);
  }
  const keys = allKeys(email);
  for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
  expect(JSON.stringify(email)).not.toContain("OUR SECRET PROMPT TEMPLATE");
  // What the customer needs is still there.
  expect(email).toMatchObject({
    id: "gen-1",
    leadId: "lead-1",
    campaignId: "camp-1",
    brandIds: ["brand-1"],
    subject: "Hello Ada",
    bodyText: "Hi",
    leadFirstName: "Ada",
    createdAt: "2026-10-12T00:00:00Z",
  });
  expect(email.sequence).toEqual([
    { step: 1, bodyHtml: "<p>Hi</p>", bodyText: "Hi", daysSinceLastStep: 0 },
    { step: 2, bodyHtml: "<p>Again</p>", bodyText: "Again", daysSinceLastStep: 3 },
  ]);
}

const NON_STAFF_CALLERS: Array<[string, Record<string, string>]> = [
  ["customer API key (Bearer)", { authorization: "Bearer distrib.usr_x" }],
  ["customer dashboard session (platform key, customer email)", { "x-api-key": PLATFORM_KEY, "x-email": "client@example.com" }],
  ["platform key without x-email (MCP / service caller)", { "x-api-key": PLATFORM_KEY }],
  ["staff email on a Bearer key (no staff power through a key)", { authorization: "Bearer distrib.usr_x", "x-email": "kevin@distribute.you" }],
];
const STAFF = { "x-api-key": PLATFORM_KEY, "x-email": "kevin@distribute.you" };

beforeEach(() => {
  mockCallExternalService.mockReset();
  mockGetRunsBatch.mockReset();
  mockCallExternalService.mockImplementation(async (_svc: unknown, path: string) => {
    if (path.startsWith("/generations/by-lead/")) return { generation: { ...GENERATION_ROW } };
    if (path.startsWith("/generations")) return { generations: [{ ...GENERATION_ROW }] };
    return { id: "p", type: "cold-email", prompt: "OUR SECRET PROMPT TEMPLATE", variables: [] };
  });
  mockGetRunsBatch.mockResolvedValue(new Map([["genrun-1", RUN]]));
});

describe.each(NON_STAFF_CALLERS)("non-staff caller: %s", (_label, headers) => {
  it("GET /v1/emails?brandId= returns the customer allowlist only", async () => {
    const res = await request(app()).get("/v1/emails?brandId=brand-1").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.emails).toHaveLength(1);
    expectCustomerShape(res.body.emails[0]);
    expect(mockGetRunsBatch).not.toHaveBeenCalled();
  });

  it("GET /v1/emails/by-lead/:leadId returns the customer allowlist only", async () => {
    const res = await request(app()).get("/v1/emails/by-lead/lead-1?brandId=brand-1").set(headers);
    expect(res.status).toBe(200);
    expectCustomerShape(res.body.generation);
  });

  it("GET /v1/campaigns/:id/emails returns the customer allowlist only", async () => {
    const res = await request(app()).get("/v1/campaigns/camp-1/emails").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.emails).toHaveLength(1);
    expectCustomerShape(res.body.emails[0]);
    expect(mockGetRunsBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["get", "/v1/prompts?type=cold-email"],
    ["put", "/v1/prompts"],
    ["get", "/v1/content/platform-prompts?type=cold-email"],
    ["get", "/v1/content/prompt-assignments?featureSlug=sales"],
    ["put", "/v1/content/prompt-assignments"],
  ] as const)("%s %s is refused and never reaches content-generation", async (method, path) => {
    const res = await request(app())[method](path).set(headers).send({});
    expect([401, 403]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain("OUR SECRET PROMPT TEMPLATE");
    expect(mockCallExternalService).not.toHaveBeenCalled();
  });
});

describe("staff caller (platform key + staff x-email)", () => {
  it("keeps the full row and its generationRun on GET /v1/emails", async () => {
    const res = await request(app()).get("/v1/emails?brandId=brand-1").set(STAFF);
    expect(res.status).toBe(200);
    expect(res.body.emails[0].promptRaw).toBe("OUR SECRET PROMPT TEMPLATE");
    expect(res.body.emails[0].generationRun.totalCostInUsdCents).toBe("1.5");
  });

  it("keeps the full row on GET /v1/emails/by-lead/:leadId", async () => {
    const res = await request(app()).get("/v1/emails/by-lead/lead-1").set(STAFF);
    expect(res.body.generation.promptRaw).toBe("OUR SECRET PROMPT TEMPLATE");
  });

  it("can still read a prompt template", async () => {
    const res = await request(app()).get("/v1/prompts?type=cold-email").set(STAFF);
    expect(res.status).toBe(200);
    expect(res.body.prompt).toBe("OUR SECRET PROMPT TEMPLATE");
  });
});

it("by-lead keeps the empty state for a customer", async () => {
  mockCallExternalService.mockRejectedValueOnce(Object.assign(new Error("Generation not found"), { statusCode: 404 }));
  const res = await request(app()).get("/v1/emails/by-lead/lead-404").set(NON_STAFF_CALLERS[0][1]);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ generation: null });
});
