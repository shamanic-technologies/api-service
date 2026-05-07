import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const mockCallExternalService = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  callExternalServiceWithStatus: (...args: unknown[]) => mockCallExternalService(...args),
  externalServices: {
    costs: { url: "http://mock-costs", apiKey: "k" },
  },
}));

import express from "express";
import request from "supertest";
import costsRouter from "../../src/routes/costs.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(costsRouter);
  return app;
}

const MOCK_PLATFORM_PRICES = [
  {
    id: "pp_1",
    name: "input_tokens_sonnet_4_6",
    provider: "anthropic",
    providerDomain: "anthropic.com",
    type: "Input tokens (Sonnet 4.6)",
    unit: "1M tokens",
    costPerUnitInUsdCents: "300.0000000000",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "pp_2",
    name: "output_tokens_sonnet_4_6",
    provider: "anthropic",
    providerDomain: "anthropic.com",
    type: "Output tokens (Sonnet 4.6)",
    unit: "1M tokens",
    costPerUnitInUsdCents: "1500.0000000000",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  },
];

beforeEach(() => {
  mockCallExternalService.mockReset();
});

describe("GET /v1/costs/platform-prices", () => {
  it("proxies to costs-service /v1/platform-prices and returns array passthrough", async () => {
    mockCallExternalService.mockResolvedValueOnce(MOCK_PLATFORM_PRICES);
    const app = createApp();
    const res = await request(app).get("/v1/costs/platform-prices");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_PLATFORM_PRICES);
    expect(mockCallExternalService).toHaveBeenCalledWith(
      { url: "http://mock-costs", apiKey: "k" },
      "/v1/platform-prices",
    );
  });

  it("returns 502 when costs-service is unreachable", async () => {
    mockCallExternalService.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const app = createApp();
    const res = await request(app).get("/v1/costs/platform-prices");
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
    expect(res.body.error).toContain("ECONNREFUSED");
  });

  it("returns 502 (not the upstream status) when costs-service returns non-2xx", async () => {
    const err = new Error("Service call failed: 500") as Error & { statusCode: number };
    err.statusCode = 500;
    mockCallExternalService.mockRejectedValueOnce(err);
    const app = createApp();
    const res = await request(app).get("/v1/costs/platform-prices");
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Service call failed");
  });

  it("does NOT swallow errors with an empty array", async () => {
    mockCallExternalService.mockRejectedValueOnce(new Error("boom"));
    const app = createApp();
    const res = await request(app).get("/v1/costs/platform-prices");
    expect(res.status).not.toBe(200);
    expect(res.body).not.toEqual([]);
  });
});

// ── Static checks: route file shape ──────────────────────────────────────────

const costsRoutePath = path.join(__dirname, "../../src/routes/costs.ts");
const routeContent = fs.readFileSync(costsRoutePath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

describe("Costs route file shape", () => {
  it("declares the full path /v1/costs/platform-prices (no /v1 prefix added at mount)", () => {
    expect(routeContent).toContain('"/v1/costs/platform-prices"');
  });

  it("does not rename the downstream path (stays /v1/platform-prices on costs-service)", () => {
    expect(routeContent).not.toContain('"/v1/pricing/unit-costs"');
    expect(routeContent).toContain('"/v1/platform-prices"');
  });

  it("does NOT use authenticate / requireOrg / requireUser middleware (public)", () => {
    expect(routeContent).not.toContain("authenticate");
    expect(routeContent).not.toContain("requireOrg");
    expect(routeContent).not.toContain("requireUser");
  });

  it("targets externalServices.costs", () => {
    expect(routeContent).toContain("externalServices.costs");
  });

  it("forces 502 on any failure (does not forward upstream status)", () => {
    expect(routeContent).not.toContain("error.statusCode || 502");
    expect(routeContent).not.toContain("error.statusCode ?? 502");
  });
});

describe("costs service entry in service-client", () => {
  it("registers externalServices.costs with COSTS_SERVICE_URL and COSTS_SERVICE_API_KEY", () => {
    expect(serviceClientContent).toContain("costs:");
    expect(serviceClientContent).toContain("COSTS_SERVICE_URL");
    expect(serviceClientContent).toContain("COSTS_SERVICE_API_KEY");
  });
});

describe("Costs routes mounted in index.ts", () => {
  it("imports and mounts costsRoutes at root (public, no /v1 prefix)", () => {
    expect(indexContent).toContain("costsRoutes");
    expect(indexContent).toContain("./routes/costs");
    expect(indexContent).toContain("app.use(costsRoutes)");
  });
});

describe("CORS allowlist includes public landing origins", () => {
  it("includes landing.distribute.you", () => {
    expect(indexContent).toContain("https://landing.distribute.you");
  });

  it("includes sales-cold-emails.distribute.you", () => {
    expect(indexContent).toContain("https://sales-cold-emails.distribute.you");
  });
});

describe("Costs OpenAPI schema", () => {
  it("registers GET /v1/costs/platform-prices", () => {
    expect(schemaContent).toContain('path: "/v1/costs/platform-prices"');
  });

  it("uses Public Costs tag", () => {
    expect(schemaContent).toContain('tags: ["Public Costs"]');
  });

  it("declares 200 and 502 responses", () => {
    const block = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/costs/platform-prices"'),
      schemaContent.indexOf('path: "/v1/costs/platform-prices"') + 2000,
    );
    expect(block).toContain("200:");
    expect(block).toContain("502:");
  });
});
