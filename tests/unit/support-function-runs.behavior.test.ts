import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { authenticate, AuthenticatedRequest } from "../../src/middleware/auth.js";
import { supportFunctionFor, SUPPORT_RULES } from "../../src/lib/support-function.js";

vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({ id: "run-1", status: "completed" }),
}));

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: vi.fn(),
  externalServices: { key: { url: "http://key", apiKey: "k" }, client: { url: "http://client", apiKey: "c" } },
}));

import { createRun } from "@distribute/runs-client";
const mockCreateRun = vi.mocked(createRun);

const ADMIN_KEY = "test-admin-distribute-key";
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function app() {
  const a = express();
  a.use(express.json());
  const chat = express.Router();
  chat.post("/chat", authenticate, (_req: AuthenticatedRequest, res) => res.json({ ok: true }));
  a.use("/v1", chat);
  const audiences = express.Router();
  audiences.post("/orgs/audiences/split/confirm", authenticate, (_req, res) => res.json({ ok: true }));
  audiences.post("/campaigns", authenticate, (_req, res) => res.json({ ok: true }));
  audiences.post("/brands/:id/offers/:offerId/image", authenticate, (_req, res) => res.json({ ok: true }));
  a.use("/v1", audiences);
  return a;
}

const call = (path: string) =>
  request(app()).post(path).set("x-api-key", ADMIN_KEY).set("x-org-id", ORG).set("x-user-id", USER).send({});

beforeEach(() => {
  process.env.ADMIN_DISTRIBUTE_API_KEY = ADMIN_KEY;
  mockCreateRun.mockClear();
});

describe("gateway request runs carry their support function at creation", () => {
  it("marks a Copilot run `copilot`", async () => {
    expect((await call("/v1/chat")).status).toBe(200);
    expect(mockCreateRun.mock.calls[0][0]).toMatchObject({
      taskName: "POST /v1/chat",
      support: { kind: "copilot", reason: "api-service: Copilot conversation" },
    });
  });

  it("marks an onboarding run `product_feature`", async () => {
    await call("/v1/orgs/audiences/split/confirm");
    expect(mockCreateRun.mock.calls[0][0].support).toEqual({ kind: "product_feature", reason: "api-service: onboarding: audience split confirm" });
  });

  it("matches a route with ids in its path", async () => {
    await call("/v1/brands/b1/offers/o1/image");
    expect(mockCreateRun.mock.calls[0][0].support?.kind).toBe("product_feature");
  });

  it("never marks a route that produces outcomes (campaign creation)", async () => {
    await call("/v1/campaigns");
    expect(mockCreateRun.mock.calls[0][0]).not.toHaveProperty("support");
  });
});

describe("supportFunctionFor", () => {
  it("is method-exact and anchored", () => {
    expect(supportFunctionFor("PATCH", "/v1/chat")).toBeNull();
    expect(supportFunctionFor("PATCH", "/v1/orgs/audiences/a1/status")).toBeNull();
    expect(supportFunctionFor("POST", "/v1/campaigns")).toBeNull();
    expect(supportFunctionFor("POST", "/v1/content/generate-expert-quote-pitch")).toBeNull();
    expect(supportFunctionFor("POST", "/v1/chat/sessions")).toBeNull();
    expect(supportFunctionFor("POST", "/v1/orgs/opportunities/x/reply")).toBeNull();
    expect(supportFunctionFor("POST", "/v1/emails/send")).toBeNull();
    // A campaign edit can resume the campaign: its workflow then runs under this request run.
    expect(supportFunctionFor("PATCH", "/v1/campaigns/f4306262-c845-401a-92a8-fdb923754875")).toBeNull();
    expect(supportFunctionFor("POST", "/v1/campaigns/c1/stop")).toBeNull();
    expect(supportFunctionFor("POST", "/v1/brands/extract-fields")?.kind).toBe("brand_setup");
    expect(supportFunctionFor("POST", "/v1/features/sales-cold-email-outreach/prefill")?.kind).toBe("product_feature");
    expect(supportFunctionFor("POST", "/v1/orgs/audiences/a1/preview/companies/2/email-check")?.kind).toBe("product_feature");
  });

  it("files a read as a product feature and a retired product apart", () => {
    expect(supportFunctionFor("GET", "/v1/leads/bucket-counts")).toEqual({ kind: "product_feature", reason: "api-service: dashboard read" });
    expect(supportFunctionFor("GET", "/v1/orgs/audiences/a1/preview/companies")?.reason).toBe("api-service: audience preview");
    expect(supportFunctionFor("GET", "/v1/campaigns/c1/journalists")?.kind).toBe("retired_product");
    expect(supportFunctionFor("POST", "/v1/workflows/upgrade")?.kind).toBe("product_feature");
  });

  it("only names functions runs-service knows", () => {
    for (const r of SUPPORT_RULES) expect(["copilot", "product_feature", "brand_setup", "retired_product"]).toContain(r.fn);
  });
});
