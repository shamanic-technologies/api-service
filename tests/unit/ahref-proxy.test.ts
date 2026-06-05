import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/ahref.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Ahref proxy routes", () => {
  it("should have GET /orgs/domains/traffic-history with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/domains/traffic-history"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /orgs/domains/dr-status with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/domains/dr-status"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward the domains query param on traffic-history", () => {
    const idx = content.indexOf('"/orgs/domains/traffic-history"');
    const section = content.slice(idx, idx + 800);
    expect(section).toContain('"domains"');
  });

  it("should forward the domains query param on dr-status", () => {
    const idx = content.indexOf('"/orgs/domains/dr-status"');
    const section = content.slice(idx, idx + 800);
    expect(section).toContain('"domains"');
  });

  it("should have GET /orgs/domains/ai-visibility with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/domains/ai-visibility"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward the domains query param on ai-visibility GET", () => {
    const lines = content.split("\n");
    const idx = lines.findIndex((l) =>
      l.includes("router.get") && l.includes('"/orgs/domains/ai-visibility"')
    );
    expect(idx).toBeGreaterThan(-1);
    const section = lines.slice(idx, idx + 20).join("\n");
    expect(section).toContain('"domains"');
  });

  it("should have POST /orgs/domains/traffic-compute with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/orgs/domains/traffic-compute"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have POST /orgs/domains/dr-compute with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/orgs/domains/dr-compute"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have POST /orgs/domains/ai-visibility with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/orgs/domains/ai-visibility"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward req.body on every POST compute endpoint (3x)", () => {
    const matches = content.match(/body: req\.body/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("should call externalServices.ahref for every endpoint (6x)", () => {
    const matches = content.match(/externalServices\.ahref/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(6);
  });

  it("should use buildInternalHeaders for every endpoint (6x)", () => {
    const matches = content.match(/buildInternalHeaders\(req\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(6);
  });

  it("should preserve downstream paths (no path renaming)", () => {
    expect(content).toContain('"/orgs/domains/traffic-history"');
    expect(content).toContain('"/orgs/domains/dr-status"');
    expect(content).toContain('"/orgs/domains/traffic-compute"');
    expect(content).toContain('"/orgs/domains/dr-compute"');
    expect(content).toContain('"/orgs/domains/ai-visibility"');
  });
});

describe("ahref service client", () => {
  it("should have ahref entry in externalServices", () => {
    expect(serviceClientContent).toContain("ahref: {");
  });

  it("should read AHREF_SERVICE_URL with no fallback", () => {
    expect(serviceClientContent).toContain("AHREF_SERVICE_URL");
    expect(serviceClientContent).toContain("AHREF_SERVICE_URL env var is required");
  });

  it("should read AHREF_SERVICE_API_KEY with no fallback", () => {
    expect(serviceClientContent).toContain("AHREF_SERVICE_API_KEY");
    expect(serviceClientContent).toContain("AHREF_SERVICE_API_KEY env var is required");
  });

  it("should throw when AHREF_SERVICE_URL is unset", async () => {
    const original = process.env.AHREF_SERVICE_URL;
    delete process.env.AHREF_SERVICE_URL;
    try {
      const { externalServices } = await import("../../src/lib/service-client.js");
      expect(() => externalServices.ahref.url).toThrow(/AHREF_SERVICE_URL/);
    } finally {
      if (original !== undefined) process.env.AHREF_SERVICE_URL = original;
    }
  });

  it("should throw when AHREF_SERVICE_API_KEY is unset", async () => {
    const original = process.env.AHREF_SERVICE_API_KEY;
    delete process.env.AHREF_SERVICE_API_KEY;
    try {
      const { externalServices } = await import("../../src/lib/service-client.js");
      expect(() => externalServices.ahref.apiKey).toThrow(/AHREF_SERVICE_API_KEY/);
    } finally {
      if (original !== undefined) process.env.AHREF_SERVICE_API_KEY = original;
    }
  });
});

describe("Ahref OpenAPI schemas", () => {
  it("should register GET /v1/orgs/domains/traffic-history as passthrough", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/domains/traffic-history"');
    expect(schemaContent).toContain("DomainsTrafficHistoryResponse");
  });

  it("should register GET /v1/orgs/domains/dr-status as passthrough", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/domains/dr-status"');
    expect(schemaContent).toContain("DomainsDrStatusResponse");
  });

  it("should declare both GET response schemas as passthrough (no field re-declaration)", () => {
    expect(schemaContent).toMatch(/DomainsTrafficHistoryResponseSchema = z\.object\(\{\}\)\.passthrough\(\)/);
    expect(schemaContent).toMatch(/DomainsDrStatusResponseSchema = z\.object\(\{\}\)\.passthrough\(\)/);
  });

  it("should register GET /v1/orgs/domains/ai-visibility (read cache) as passthrough", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/domains/ai-visibility"');
    expect(schemaContent).toContain("DomainsAiVisibilityReadResponse");
  });

  it("should declare the GET ai-visibility read response schema as passthrough (no field re-declaration)", () => {
    expect(schemaContent).toMatch(/DomainsAiVisibilityReadResponseSchema = z\.object\(\{\}\)\.passthrough\(\)/);
  });

  it("should register the 3 POST compute paths", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/domains/traffic-compute"');
    expect(schemaContent).toContain('path: "/v1/orgs/domains/dr-compute"');
    expect(schemaContent).toContain('path: "/v1/orgs/domains/ai-visibility"');
  });

  it("should declare all POST request + response schemas as passthrough (no field re-declaration)", () => {
    for (const name of [
      "DomainsTrafficComputeRequest",
      "DomainsTrafficComputeResponse",
      "DomainsDrComputeRequest",
      "DomainsDrComputeResponse",
      "DomainsAiVisibilityRequest",
      "DomainsAiVisibilityResponse",
    ]) {
      expect(schemaContent).toMatch(
        new RegExp(`${name}Schema = z\\.object\\(\\{\\}\\)\\.passthrough\\(\\)`)
      );
    }
  });

  it("should use the Ahrefs tag", () => {
    expect(schemaContent).toContain('tags: ["Ahrefs"]');
  });
});

describe("Ahref endpoints in openapi.json", () => {
  const openapiPath = path.join(__dirname, "../../openapi.json");
  const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

  it("should include /v1/orgs/domains/traffic-history GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/domains/traffic-history"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/domains/traffic-history"].get).toBeDefined();
  });

  it("should include /v1/orgs/domains/dr-status GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/domains/dr-status"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/domains/dr-status"].get).toBeDefined();
  });

  it("should list domains as a query parameter on all GET endpoints", () => {
    for (const p of [
      "/v1/orgs/domains/traffic-history",
      "/v1/orgs/domains/dr-status",
      "/v1/orgs/domains/ai-visibility",
    ]) {
      const get = openapi.paths[p].get;
      const params = (get.parameters ?? []) as Array<{ name: string; in: string }>;
      const found = params.find((x) => x.name === "domains" && x.in === "query");
      expect(found).toBeDefined();
    }
  });

  it("should include /v1/orgs/domains/ai-visibility GET (read cache) in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/domains/ai-visibility"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/domains/ai-visibility"].get).toBeDefined();
  });

  it("should keep both GET and POST on /v1/orgs/domains/ai-visibility (method-keyed coexist)", () => {
    expect(openapi.paths["/v1/orgs/domains/ai-visibility"].get).toBeDefined();
    expect(openapi.paths["/v1/orgs/domains/ai-visibility"].post).toBeDefined();
  });

  it("should include the 3 POST compute endpoints in committed openapi.json", () => {
    for (const p of [
      "/v1/orgs/domains/traffic-compute",
      "/v1/orgs/domains/dr-compute",
      "/v1/orgs/domains/ai-visibility",
    ]) {
      expect(openapi.paths[p]).toBeDefined();
      expect(openapi.paths[p].post).toBeDefined();
    }
  });
});

describe("Ahref routes are mounted in index.ts", () => {
  it("should import and mount ahref routes", () => {
    expect(indexContent).toContain("ahrefRoutes");
    expect(indexContent).toContain("./routes/ahref");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", ahrefRoutes)');
  });
});
