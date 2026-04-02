import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";

// Mock auth middleware
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

interface FetchCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];

import platformRouter from "../../src/routes/platform.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", platformRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Static checks (consistent with repo pattern)
// ---------------------------------------------------------------------------

const platformRoutePath = path.join(__dirname, "../../src/routes/platform.ts");
const platformContent = fs.readFileSync(platformRoutePath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const envExamplePath = path.join(__dirname, "../../.env.example");
const envContent = fs.readFileSync(envExamplePath, "utf-8");

describe("Platform proxy routes", () => {
  it("should have GET /platform/services endpoint", () => {
    expect(platformContent).toContain('"/platform/services"');
    expect(platformContent).toContain("router.get");
  });

  it("should have GET /platform/services/:service endpoint", () => {
    expect(platformContent).toContain('"/platform/services/:service"');
  });

  it("should have GET /platform/llm-context endpoint", () => {
    expect(platformContent).toContain('"/platform/llm-context"');
  });

  it("should have GET /platform/llm-context/:service endpoint", () => {
    expect(platformContent).toContain('"/platform/llm-context/:service"');
  });

  it("should use authenticate, requireOrg, requireUser on all endpoints", () => {
    const routeLines = platformContent.split("\n").filter((l) => l.includes("router.get"));
    expect(routeLines.length).toBe(4);
    for (const line of routeLines) {
      expect(line).toContain("authenticate");
      expect(line).toContain("requireOrg");
      expect(line).toContain("requireUser");
    }
  });

  it("should proxy /platform/services to api-registry /services", () => {
    expect(platformContent).toContain('"/services"');
    expect(platformContent).toContain("externalServices.apiRegistry");
  });

  it("should proxy /platform/services/:service to api-registry /openapi/:service", () => {
    expect(platformContent).toContain("`/openapi/${service}`");
  });

  it("should proxy /platform/llm-context to api-registry /llm-context", () => {
    expect(platformContent).toContain('"/llm-context"');
  });

  it("should use buildInternalHeaders for identity forwarding", () => {
    expect(platformContent).toContain("buildInternalHeaders");
    const headerMatches = platformContent.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(4);
  });

  it("should forward upstream status codes on error", () => {
    expect(platformContent).toContain("error.statusCode || 500");
  });
});

describe("API Registry service client config", () => {
  it("should define apiRegistry in externalServices", () => {
    expect(serviceClientContent).toContain("apiRegistry:");
    expect(serviceClientContent).toContain("API_REGISTRY_SERVICE_URL");
    expect(serviceClientContent).toContain("API_REGISTRY_SERVICE_API_KEY");
  });
});

describe("Platform routes are mounted in index.ts", () => {
  it("should import and mount platform routes", () => {
    expect(indexContent).toContain("platformRoutes");
    expect(indexContent).toContain("./routes/platform");
  });
});

describe("Environment config", () => {
  it("should document API_REGISTRY env vars in .env.example", () => {
    expect(envContent).toContain("API_REGISTRY_SERVICE_URL");
    expect(envContent).toContain("API_REGISTRY_SERVICE_API_KEY");
  });
});

describe("Platform OpenAPI schemas", () => {
  it("should register platform service paths in schemas", () => {
    expect(schemaContent).toContain('path: "/v1/platform/services"');
    expect(schemaContent).toContain('path: "/v1/platform/services/{service}"');
    expect(schemaContent).toContain('path: "/v1/platform/llm-context"');
    expect(schemaContent).toContain('path: "/v1/platform/llm-context/{service}"');
    expect(schemaContent).toContain('tags: ["Platform"]');
    expect(schemaContent).toContain('"PlatformServicesResponse"');
    expect(schemaContent).toContain('"LlmContextResponse"');
    expect(schemaContent).toContain('"LlmServiceDetailResponse"');
  });
});

// ---------------------------------------------------------------------------
// Integration tests (supertest)
// ---------------------------------------------------------------------------

describe("GET /v1/platform/services — integration", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({
        url,
        method: init?.method,
        headers: Object.fromEntries(Object.entries(init?.headers || {})),
      });

      if (url.includes("/services")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            services: [
              { name: "lead", baseUrl: "https://lead.distribute.you", openapiUrl: "https://lead.distribute.you/openapi.json" },
              { name: "campaign", baseUrl: "https://campaign.distribute.you", openapiUrl: "https://campaign.distribute.you/openapi.json" },
            ],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
  });

  it("should proxy to api-registry /services", async () => {
    const res = await request(app).get("/v1/platform/services");

    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(2);
    expect(res.body.services[0].name).toBe("lead");
  });

  it("should forward internal headers", async () => {
    await request(app).get("/v1/platform/services");

    const registryCall = fetchCalls.find((c) => c.url.includes("/services"));
    expect(registryCall?.headers?.["x-org-id"]).toBe("org_test456");
    expect(registryCall?.headers?.["x-user-id"]).toBe("user_test123");
  });

  it("should forward upstream error status codes", async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return { ok: false, status: 401, text: () => Promise.resolve('{"error":"Invalid or missing API key"}') };
    });
    app = createApp();

    const res = await request(app).get("/v1/platform/services");
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/platform/services/:service — integration", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });

      if (url.includes("/openapi/lead")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            openapi: "3.0.0",
            info: { title: "Lead Service", version: "1.0.0" },
            paths: { "/search": { post: { summary: "Search leads" } } },
          }),
        };
      }
      if (url.includes("/openapi/nonexistent")) {
        return {
          ok: false,
          status: 404,
          text: () => Promise.resolve('{"error":"Service \\"nonexistent\\" not found"}'),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
  });

  it("should proxy to api-registry /openapi/:service", async () => {
    const res = await request(app).get("/v1/platform/services/lead");

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.0");
    expect(res.body.info.title).toBe("Lead Service");
  });

  it("should return 404 for unknown service", async () => {
    const res = await request(app).get("/v1/platform/services/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/platform/llm-context — integration", () => {
  let app: express.Express;

  const mockLlmContext = {
    _description: "Compact summary of all platform services",
    _workflow: "1. Read this overview  2. GET /llm-context/{service} for endpoint details",
    serviceCount: 1,
    services: [
      {
        service: "lead",
        title: "Lead Service",
        description: "Find and manage leads",
        endpointCount: 3,
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });

      if (url.includes("/llm-context")) {
        return { ok: true, json: () => Promise.resolve(mockLlmContext) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
  });

  it("should proxy to api-registry /llm-context with lightweight format", async () => {
    const res = await request(app).get("/v1/platform/llm-context");

    expect(res.status).toBe(200);
    expect(res.body._description).toBeDefined();
    expect(res.body._workflow).toBeDefined();
    expect(res.body.serviceCount).toBe(1);
    expect(res.body.services).toHaveLength(1);
    expect(res.body.services[0].service).toBe("lead");
    expect(res.body.services[0].endpointCount).toBe(3);
    // Should NOT have inline endpoints (progressive disclosure)
    expect(res.body.services[0].endpoints).toBeUndefined();
    expect(res.body.services[0].baseUrl).toBeUndefined();
  });

  it("should handle upstream failure gracefully", async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return { ok: false, status: 502, text: () => Promise.resolve('{"error":"upstream error"}') };
    });
    app = createApp();

    const res = await request(app).get("/v1/platform/llm-context");
    expect(res.status).toBe(502);
  });
});

describe("GET /v1/platform/llm-context/:service — integration", () => {
  let app: express.Express;

  const mockServiceDetail = {
    service: "lead",
    title: "Lead Service",
    description: "Find and manage leads",
    endpointCount: 2,
    endpoints: [
      { method: "POST", path: "/search", summary: "Search leads by ICP criteria" },
      { method: "GET", path: "/search/:id", summary: "Get lead by ID" },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });

      if (url.includes("/llm-context/lead")) {
        return { ok: true, json: () => Promise.resolve(mockServiceDetail) };
      }
      if (url.includes("/llm-context/nonexistent")) {
        return {
          ok: false,
          status: 404,
          text: () => Promise.resolve('{"error":"Service \\"nonexistent\\" not found"}'),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
  });

  it("should proxy to api-registry /llm-context/:service with endpoint details", async () => {
    const res = await request(app).get("/v1/platform/llm-context/lead");

    expect(res.status).toBe(200);
    expect(res.body.service).toBe("lead");
    expect(res.body.endpointCount).toBe(2);
    expect(res.body.endpoints).toHaveLength(2);
    expect(res.body.endpoints[0].method).toBe("POST");
  });

  it("should forward query parameters to api-registry", async () => {
    await request(app).get("/v1/platform/llm-context/lead?method=POST&group=search");

    const registryCall = fetchCalls.find((c) => c.url.includes("/llm-context/lead"));
    expect(registryCall?.url).toContain("method=POST");
    expect(registryCall?.url).toContain("group=search");
  });

  it("should return 404 for unknown service", async () => {
    const res = await request(app).get("/v1/platform/llm-context/nonexistent");
    expect(res.status).toBe(404);
  });
});
