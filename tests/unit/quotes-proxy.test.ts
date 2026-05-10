import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/quotes.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Expert quotes proxy routes", () => {
  it("should have GET /orgs/quote-requests with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/quote-requests"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /orgs/quote-requests/stats with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/quote-requests/stats"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should mount /orgs/quote-requests/stats BEFORE /orgs/quote-requests/:id (Express order matters)", () => {
    const statsIdx = content.indexOf('"/orgs/quote-requests/stats"');
    const idIdx = content.indexOf('"/orgs/quote-requests/:id"');
    expect(statsIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(-1);
    expect(statsIdx).toBeLessThan(idIdx);
  });

  it("should have GET /orgs/quote-requests/:id with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/quote-requests/:id"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward :id param into downstream path on GET /orgs/quote-requests/:id", () => {
    const idx = content.indexOf('"/orgs/quote-requests/:id"');
    const section = content.slice(idx, idx + 700);
    expect(section).toContain("req.params.id");
    expect(section).toMatch(/\/orgs\/quote-requests\/\$\{[^}]*encodeURIComponent[^}]*\}/);
  });

  it("should have GET /orgs/quote-pitches with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/quote-pitches"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /orgs/quote-pitches/:id with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/quote-pitches/:id"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward :id param into downstream path on GET /orgs/quote-pitches/:id", () => {
    const idx = content.indexOf('"/orgs/quote-pitches/:id"');
    const section = content.slice(idx, idx + 700);
    expect(section).toContain("req.params.id");
    expect(section).toMatch(/\/orgs\/quote-pitches\/\$\{[^}]*encodeURIComponent[^}]*\}/);
  });

  it("should forward campaign_id/source/limit/offset on GET /orgs/quote-requests", () => {
    const idx = content.indexOf('"/orgs/quote-requests"');
    const section = content.slice(idx, idx + 800);
    for (const param of ["campaign_id", "source", "limit", "offset"]) {
      expect(section).toContain(`"${param}"`);
    }
  });

  it("should forward campaign_id on GET /orgs/quote-requests/stats", () => {
    const idx = content.indexOf('"/orgs/quote-requests/stats"');
    const section = content.slice(idx, idx + 800);
    expect(section).toContain('"campaign_id"');
  });

  it("should forward campaign_id/status/limit/offset on GET /orgs/quote-pitches", () => {
    const idx = content.indexOf('"/orgs/quote-pitches"');
    const section = content.slice(idx, idx + 800);
    for (const param of ["campaign_id", "status", "limit", "offset"]) {
      expect(section).toContain(`"${param}"`);
    }
  });

  it("should call externalServices.journalistsQuotes for every endpoint (5x)", () => {
    const matches = content.match(/externalServices\.journalistsQuotes/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(5);
  });

  it("should use buildInternalHeaders for every endpoint (5x)", () => {
    const matches = content.match(/buildInternalHeaders\(req\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(5);
  });

  it("should preserve downstream paths (no path renaming)", () => {
    expect(content).toContain('"/orgs/quote-requests"');
    expect(content).toContain('"/orgs/quote-requests/stats"');
    expect(content).toContain('"/orgs/quote-requests/:id"');
    expect(content).toContain('"/orgs/quote-pitches"');
    expect(content).toContain('"/orgs/quote-pitches/:id"');
  });
});

describe("journalistsQuotes service client", () => {
  it("should have journalistsQuotes entry in externalServices", () => {
    expect(serviceClientContent).toContain("journalistsQuotes: {");
  });

  it("should read JOURNALISTS_QUOTES_SERVICE_URL with no fallback", () => {
    expect(serviceClientContent).toContain("JOURNALISTS_QUOTES_SERVICE_URL");
    expect(serviceClientContent).toContain("JOURNALISTS_QUOTES_SERVICE_URL env var is required");
  });

  it("should read JOURNALISTS_QUOTES_SERVICE_API_KEY with no fallback", () => {
    expect(serviceClientContent).toContain("JOURNALISTS_QUOTES_SERVICE_API_KEY");
    expect(serviceClientContent).toContain("JOURNALISTS_QUOTES_SERVICE_API_KEY env var is required");
  });

  it("should throw when JOURNALISTS_QUOTES_SERVICE_URL is unset", async () => {
    const original = process.env.JOURNALISTS_QUOTES_SERVICE_URL;
    delete process.env.JOURNALISTS_QUOTES_SERVICE_URL;
    try {
      const { externalServices } = await import("../../src/lib/service-client.js");
      expect(() => externalServices.journalistsQuotes.url).toThrow(/JOURNALISTS_QUOTES_SERVICE_URL/);
    } finally {
      if (original !== undefined) process.env.JOURNALISTS_QUOTES_SERVICE_URL = original;
    }
  });

  it("should throw when JOURNALISTS_QUOTES_SERVICE_API_KEY is unset", async () => {
    const original = process.env.JOURNALISTS_QUOTES_SERVICE_API_KEY;
    delete process.env.JOURNALISTS_QUOTES_SERVICE_API_KEY;
    try {
      const { externalServices } = await import("../../src/lib/service-client.js");
      expect(() => externalServices.journalistsQuotes.apiKey).toThrow(/JOURNALISTS_QUOTES_SERVICE_API_KEY/);
    } finally {
      if (original !== undefined) process.env.JOURNALISTS_QUOTES_SERVICE_API_KEY = original;
    }
  });
});

describe("Expert quotes OpenAPI schemas", () => {
  it("should register GET /v1/orgs/quote-requests", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/quote-requests"');
    expect(schemaContent).toContain("QuoteRequestsListResponse");
  });

  it("should register GET /v1/orgs/quote-requests/stats", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/quote-requests/stats"');
    expect(schemaContent).toContain("QuoteRequestsStatsResponse");
  });

  it("should register GET /v1/orgs/quote-requests/{id}", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/quote-requests/{id}"');
    expect(schemaContent).toContain("QuoteRequestResponse");
  });

  it("should register GET /v1/orgs/quote-pitches", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/quote-pitches"');
    expect(schemaContent).toContain("QuotePitchesListResponse");
  });

  it("should register GET /v1/orgs/quote-pitches/{id}", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/quote-pitches/{id}"');
    expect(schemaContent).toContain("QuotePitchResponse");
  });

  it("should use Expert Quotes tag", () => {
    expect(schemaContent).toContain('tags: ["Expert Quotes"]');
  });
});

describe("Expert quotes endpoints in openapi.json", () => {
  const openapiPath = path.join(__dirname, "../../openapi.json");
  const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

  it("should include /v1/orgs/quote-requests GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/quote-requests"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/quote-requests"].get).toBeDefined();
  });

  it("should include /v1/orgs/quote-requests/stats GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/quote-requests/stats"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/quote-requests/stats"].get).toBeDefined();
  });

  it("should include /v1/orgs/quote-requests/{id} GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/quote-requests/{id}"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/quote-requests/{id}"].get).toBeDefined();
  });

  it("should include /v1/orgs/quote-pitches GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/quote-pitches"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/quote-pitches"].get).toBeDefined();
  });

  it("should include /v1/orgs/quote-pitches/{id} GET in committed openapi.json", () => {
    expect(openapi.paths["/v1/orgs/quote-pitches/{id}"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/quote-pitches/{id}"].get).toBeDefined();
  });
});

describe("Quotes routes are mounted in index.ts", () => {
  it("should import and mount quotes routes", () => {
    expect(indexContent).toContain("quotesRoutes");
    expect(indexContent).toContain("./routes/quotes");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", quotesRoutes)');
  });
});
