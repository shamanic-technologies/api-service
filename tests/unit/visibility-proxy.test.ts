import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/visibility.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("AI visibility proxy routes", () => {
  it("should have GET /orgs/visibility-score-runs with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/visibility-score-runs"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /orgs/visibility-score-runs/:id with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/visibility-score-runs/:id"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward :id param into downstream path on GET /orgs/visibility-score-runs/:id", () => {
    const idx = content.indexOf('"/orgs/visibility-score-runs/:id"');
    const section = content.slice(idx, idx + 700);
    expect(section).toContain("req.params.id");
    expect(section).toMatch(/\/orgs\/visibility-score-runs\/\$\{[^}]*encodeURIComponent[^}]*\}/);
  });

  it("should forward brandId/domain/from/to/limit/offset/campaignId on GET /orgs/visibility-score-runs", () => {
    const idx = content.indexOf('"/orgs/visibility-score-runs"');
    const section = content.slice(idx, idx + 800);
    for (const param of ["brandId", "domain", "from", "to", "limit", "offset", "campaignId"]) {
      expect(section).toContain(`"${param}"`);
    }
  });

  it("should have POST /orgs/visibility-score-runs with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/orgs/visibility-score-runs"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward req.body on POST /orgs/visibility-score-runs", () => {
    const idx = content.indexOf('router.post("/orgs/visibility-score-runs"');
    expect(idx).toBeGreaterThan(-1);
    const section = content.slice(idx, idx + 900);
    expect(section).toContain('method: "POST"');
    expect(section).toContain("body: req.body");
  });

  it("should call externalServices.aiVisibility for every endpoint (3x)", () => {
    const matches = content.match(/externalServices\.aiVisibility/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("should use buildInternalHeaders for every endpoint (3x)", () => {
    const matches = content.match(/buildInternalHeaders\(req\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("should preserve downstream paths (no path renaming)", () => {
    expect(content).toContain('"/orgs/visibility-score-runs"');
    expect(content).toContain('"/orgs/visibility-score-runs/:id"');
  });
});

describe("aiVisibility service client", () => {
  it("should have aiVisibility entry in externalServices", () => {
    expect(serviceClientContent).toContain("aiVisibility: {");
  });

  it("should read AI_VISIBILITY_SCORE_SERVICE_URL with no fallback", () => {
    expect(serviceClientContent).toContain("AI_VISIBILITY_SCORE_SERVICE_URL");
    expect(serviceClientContent).toContain("AI_VISIBILITY_SCORE_SERVICE_URL env var is required");
  });

  it("should read AI_VISIBILITY_SCORE_SERVICE_API_KEY with no fallback", () => {
    expect(serviceClientContent).toContain("AI_VISIBILITY_SCORE_SERVICE_API_KEY");
    expect(serviceClientContent).toContain("AI_VISIBILITY_SCORE_SERVICE_API_KEY env var is required");
  });

  it("should throw when AI_VISIBILITY_SCORE_SERVICE_URL is unset", async () => {
    const original = process.env.AI_VISIBILITY_SCORE_SERVICE_URL;
    delete process.env.AI_VISIBILITY_SCORE_SERVICE_URL;
    try {
      const { externalServices } = await import("../../src/lib/service-client.js");
      expect(() => externalServices.aiVisibility.url).toThrow(/AI_VISIBILITY_SCORE_SERVICE_URL/);
    } finally {
      if (original !== undefined) process.env.AI_VISIBILITY_SCORE_SERVICE_URL = original;
    }
  });

  it("should throw when AI_VISIBILITY_SCORE_SERVICE_API_KEY is unset", async () => {
    const original = process.env.AI_VISIBILITY_SCORE_SERVICE_API_KEY;
    delete process.env.AI_VISIBILITY_SCORE_SERVICE_API_KEY;
    try {
      const { externalServices } = await import("../../src/lib/service-client.js");
      expect(() => externalServices.aiVisibility.apiKey).toThrow(/AI_VISIBILITY_SCORE_SERVICE_API_KEY/);
    } finally {
      if (original !== undefined) process.env.AI_VISIBILITY_SCORE_SERVICE_API_KEY = original;
    }
  });
});

describe("AI visibility OpenAPI schemas", () => {
  it("should register GET /v1/orgs/visibility-score-runs", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/visibility-score-runs"');
    expect(schemaContent).toContain("VisibilityScoreRunsListResponse");
  });

  it("should register GET /v1/orgs/visibility-score-runs/{id}", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/visibility-score-runs/{id}"');
    expect(schemaContent).toContain("VisibilityScoreRunDetailResponse");
  });

  it("should expose campaignId on GET /v1/orgs/visibility-score-runs query", () => {
    const idx = schemaContent.indexOf('path: "/v1/orgs/visibility-score-runs"');
    const section = schemaContent.slice(idx, idx + 1200);
    expect(section).toMatch(/campaignId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
  });

  it("should register POST /v1/orgs/visibility-score-runs", () => {
    const idx = schemaContent.indexOf('path: "/v1/orgs/visibility-score-runs"');
    const next = schemaContent.indexOf('path: "/v1/orgs/visibility-score-runs"', idx + 1);
    // Two registrations of that exact path expected: one GET, one POST.
    expect(idx).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(-1);
  });

  it("should accept optional campaignId in POST body schema", () => {
    expect(schemaContent).toMatch(/VisibilityScoreRunCreateRequest/);
    const reqIdx = schemaContent.indexOf("VisibilityScoreRunCreateRequest");
    const section = schemaContent.slice(Math.max(0, reqIdx - 400), reqIdx + 400);
    expect(section).toMatch(/campaignId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
  });

  it("should use AI Visibility tag", () => {
    expect(schemaContent).toContain('tags: ["AI Visibility"]');
  });
});

describe("AI visibility endpoints in openapi.json", () => {
  const openapiPath = path.join(__dirname, "../../openapi.json");
  const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

  it("should include /v1/orgs/visibility-score-runs GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/visibility-score-runs"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/visibility-score-runs"].get).toBeDefined();
  });

  it("should include /v1/orgs/visibility-score-runs/{id} GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/visibility-score-runs/{id}"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/visibility-score-runs/{id}"].get).toBeDefined();
  });

  it("should include /v1/orgs/visibility-score-runs POST in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/visibility-score-runs"].post).toBeDefined();
  });

  it("should list campaignId as a query parameter on GET /v1/orgs/visibility-score-runs", () => {
    const get = openapi.paths["/v1/orgs/visibility-score-runs"].get;
    const params = (get.parameters ?? []) as Array<{ name: string; in: string }>;
    const found = params.find((p) => p.name === "campaignId" && p.in === "query");
    expect(found).toBeDefined();
  });
});

describe("Visibility routes are mounted in index.ts", () => {
  it("should import and mount visibility routes", () => {
    expect(indexContent).toContain("visibilityRoutes");
    expect(indexContent).toContain("./routes/visibility");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", visibilityRoutes)');
  });
});
