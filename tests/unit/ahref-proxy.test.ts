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

  it("should call externalServices.ahref for every endpoint (2x)", () => {
    const matches = content.match(/externalServices\.ahref/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("should use buildInternalHeaders for every endpoint (2x)", () => {
    const matches = content.match(/buildInternalHeaders\(req\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("should preserve downstream paths (no path renaming)", () => {
    expect(content).toContain('"/orgs/domains/traffic-history"');
    expect(content).toContain('"/orgs/domains/dr-status"');
  });

  it("should NOT proxy any POST scrape endpoints (read-only)", () => {
    expect(content).not.toContain("router.post");
    expect(content).not.toContain("dr-compute");
    expect(content).not.toContain("traffic-compute");
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

  it("should declare both response schemas as passthrough (no field re-declaration)", () => {
    expect(schemaContent).toMatch(/DomainsTrafficHistoryResponseSchema = z\.object\(\{\}\)\.passthrough\(\)/);
    expect(schemaContent).toMatch(/DomainsDrStatusResponseSchema = z\.object\(\{\}\)\.passthrough\(\)/);
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

  it("should list domains as a query parameter on both endpoints", () => {
    for (const p of ["/v1/orgs/domains/traffic-history", "/v1/orgs/domains/dr-status"]) {
      const get = openapi.paths[p].get;
      const params = (get.parameters ?? []) as Array<{ name: string; in: string }>;
      const found = params.find((x) => x.name === "domains" && x.in === "query");
      expect(found).toBeDefined();
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
