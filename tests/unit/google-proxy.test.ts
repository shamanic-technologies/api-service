import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/google.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Google CRM proxy routes", () => {
  it("should have POST /orgs/google/auth/start with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/orgs/google/auth/start"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /orgs/google/auth/callback with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/google/auth/callback"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward code and state on GET /orgs/google/auth/callback", () => {
    const section = content.slice(
      content.indexOf('"/orgs/google/auth/callback"'),
      content.indexOf('"/orgs/google/auth/callback"') + 800
    );
    expect(section).toContain('"code"');
    expect(section).toContain('"state"');
  });

  it("should have POST /orgs/google/sync with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/orgs/google/sync"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /orgs/google/sync/:jobId with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/google/sync/:jobId"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward jobId param into downstream path on GET /orgs/google/sync/:jobId", () => {
    const idx = content.indexOf('"/orgs/google/sync/:jobId"');
    expect(idx).toBeGreaterThan(-1);
    const section = content.slice(idx, idx + 600);
    expect(section).toContain("req.params.jobId");
    expect(section).toMatch(/\/orgs\/google\/sync\/\$\{[^}]*jobId[^}]*\}/);
  });

  it("should have GET /orgs/google/messages with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/google/messages"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward limit/cursor/account_id/thread_id/participant on GET /orgs/google/messages", () => {
    const section = content.slice(
      content.indexOf('"/orgs/google/messages"'),
      content.indexOf('"/orgs/google/messages"') + 800
    );
    for (const param of ["limit", "cursor", "account_id", "thread_id", "participant"]) {
      expect(section).toContain(`"${param}"`);
    }
  });

  it("should have PUT /orgs/google/contact-links with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.put") && l.includes('"/orgs/google/contact-links"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward body as-is on PUT /orgs/google/contact-links (no transform)", () => {
    const idx = content.indexOf('"/orgs/google/contact-links"');
    expect(idx).toBeGreaterThan(-1);
    const section = content.slice(idx, idx + 400);
    expect(section).toContain('method: "PUT"');
    expect(section).toContain("body: req.body");
  });

  it("should have GET /orgs/google/contacts with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/google/contacts"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward limit/cursor/account_id/query on GET /orgs/google/contacts", () => {
    const section = content.slice(
      content.indexOf('"/orgs/google/contacts"'),
      content.indexOf('"/orgs/google/contacts"') + 800
    );
    for (const param of ["limit", "cursor", "account_id", "query"]) {
      expect(section).toContain(`"${param}"`);
    }
  });

  it("should have GET /orgs/google/accounts with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/google/accounts"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should call externalServices.google for every endpoint", () => {
    const matches = content.match(/externalServices\.google/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(8);
  });

  it("should use buildInternalHeaders for every endpoint", () => {
    const matches = content.match(/buildInternalHeaders\(req\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(8);
  });

  it("should preserve downstream paths (no path renaming)", () => {
    expect(content).toContain('"/orgs/google/auth/start"');
    expect(content).toContain('/orgs/google/auth/callback');
    expect(content).toContain('"/orgs/google/sync"');
    expect(content).toContain('"/orgs/google/sync/:jobId"');
    expect(content).toContain('/orgs/google/messages');
    expect(content).toContain('/orgs/google/contacts');
    expect(content).toContain('"/orgs/google/accounts"');
  });
});

describe("Google service client", () => {
  it("should have google entry in externalServices", () => {
    expect(serviceClientContent).toContain("google: {");
  });

  it("should read GOOGLE_SERVICE_URL with no fallback", () => {
    expect(serviceClientContent).toContain("GOOGLE_SERVICE_URL");
    // No fallback URL — must throw if env missing
    expect(serviceClientContent).toContain("GOOGLE_SERVICE_URL env var is required");
  });

  it("should read GOOGLE_SERVICE_API_KEY with no fallback", () => {
    expect(serviceClientContent).toContain("GOOGLE_SERVICE_API_KEY");
    expect(serviceClientContent).toContain("GOOGLE_SERVICE_API_KEY env var is required");
  });

  it("should throw when GOOGLE_SERVICE_URL is unset", async () => {
    const original = process.env.GOOGLE_SERVICE_URL;
    delete process.env.GOOGLE_SERVICE_URL;
    try {
      const { externalServices } = await import("../../src/lib/service-client.js");
      expect(() => externalServices.google.url).toThrow(/GOOGLE_SERVICE_URL/);
    } finally {
      if (original !== undefined) process.env.GOOGLE_SERVICE_URL = original;
    }
  });

  it("should throw when GOOGLE_SERVICE_API_KEY is unset", async () => {
    const original = process.env.GOOGLE_SERVICE_API_KEY;
    delete process.env.GOOGLE_SERVICE_API_KEY;
    try {
      const { externalServices } = await import("../../src/lib/service-client.js");
      expect(() => externalServices.google.apiKey).toThrow(/GOOGLE_SERVICE_API_KEY/);
    } finally {
      if (original !== undefined) process.env.GOOGLE_SERVICE_API_KEY = original;
    }
  });
});

describe("Google CRM OpenAPI schemas", () => {
  it("should register POST /v1/orgs/google/auth/start", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/auth/start"');
    expect(schemaContent).toContain("GoogleAuthStartRequest");
    expect(schemaContent).toContain("GoogleAuthStartResponse");
  });

  it("should register GET /v1/orgs/google/auth/callback", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/auth/callback"');
    expect(schemaContent).toContain("GoogleAuthCallbackResponse");
  });

  it("should register POST /v1/orgs/google/sync", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/sync"');
    expect(schemaContent).toContain("GoogleSyncResponse");
  });

  it("should register GET /v1/orgs/google/sync/{jobId}", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/sync/{jobId}"');
    expect(schemaContent).toContain("GoogleSyncJobStatusResponse");
  });

  it("should declare status enum running/succeeded/failed on GoogleSyncJobStatusResponse", () => {
    const idx = schemaContent.indexOf("GoogleSyncJobStatusResponseSchema");
    expect(idx).toBeGreaterThan(-1);
    const section = schemaContent.slice(idx, idx + 1500);
    expect(section).toContain('"running"');
    expect(section).toContain('"succeeded"');
    expect(section).toContain('"failed"');
  });

  it("should register GET /v1/orgs/google/messages", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/messages"');
    expect(schemaContent).toContain("GoogleMessagesResponse");
  });

  it("should register GET /v1/orgs/google/contacts", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/contacts"');
    expect(schemaContent).toContain("GoogleContactsResponse");
  });

  it("should keep GoogleContactsResponse as passthrough so downstream links survive", () => {
    const idx = schemaContent.indexOf("GoogleContactsResponseSchema");
    expect(idx).toBeGreaterThan(-1);
    const section = schemaContent.slice(idx, idx + 200);
    expect(section).toContain(".passthrough()");
  });

  it("should register PUT /v1/orgs/google/contact-links", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/contact-links"');
    expect(schemaContent).toContain("GoogleContactLinksRequest");
    expect(schemaContent).toContain("GoogleContactLinksResponse");
  });

  it("should declare participant query param on messages", () => {
    const idx = schemaContent.indexOf('path: "/v1/orgs/google/messages"');
    expect(idx).toBeGreaterThan(-1);
    const section = schemaContent.slice(idx, idx + 600);
    expect(section).toContain("participant");
  });

  it("should register GET /v1/orgs/google/accounts", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/accounts"');
    expect(schemaContent).toContain("GoogleAccountsListResponse");
    expect(schemaContent).toContain("GoogleAccountSummary");
  });

  it("should use Google CRM tag", () => {
    expect(schemaContent).toContain('tags: ["Google CRM"]');
  });
});

describe("Google CRM accounts endpoint in openapi.json", () => {
  it("should include /v1/orgs/google/accounts in committed openapi.json", () => {
    const openapiPath = path.join(__dirname, "../../openapi.json");
    const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));
    expect(openapi.paths).toBeDefined();
    expect(openapi.paths["/v1/orgs/google/accounts"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/google/accounts"].get).toBeDefined();
  });
});

describe("Google CRM sync job poll endpoint in openapi.json", () => {
  it("should include /v1/orgs/google/sync/{jobId} GET in committed openapi.json", () => {
    const openapiPath = path.join(__dirname, "../../openapi.json");
    const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));
    expect(openapi.paths).toBeDefined();
    expect(openapi.paths["/v1/orgs/google/sync/{jobId}"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/google/sync/{jobId}"].get).toBeDefined();
  });
});

describe("Google CRM contact-links endpoint in openapi.json", () => {
  it("should include /v1/orgs/google/contact-links PUT in committed openapi.json", () => {
    const openapiPath = path.join(__dirname, "../../openapi.json");
    const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));
    expect(openapi.paths["/v1/orgs/google/contact-links"]).toBeDefined();
    expect(openapi.paths["/v1/orgs/google/contact-links"].put).toBeDefined();
  });
});

describe("Google routes are mounted in index.ts", () => {
  it("should import and mount google routes", () => {
    expect(indexContent).toContain("googleRoutes");
    expect(indexContent).toContain("./routes/google");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", googleRoutes)');
  });
});
