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

  it("should have GET /orgs/google/messages with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/orgs/google/messages"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward limit/cursor/account_id/thread_id on GET /orgs/google/messages", () => {
    const section = content.slice(
      content.indexOf('"/orgs/google/messages"'),
      content.indexOf('"/orgs/google/messages"') + 800
    );
    for (const param of ["limit", "cursor", "account_id", "thread_id"]) {
      expect(section).toContain(`"${param}"`);
    }
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

  it("should call externalServices.google for every endpoint", () => {
    const matches = content.match(/externalServices\.google/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(5);
  });

  it("should use buildInternalHeaders for every endpoint", () => {
    const matches = content.match(/buildInternalHeaders\(req\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(5);
  });

  it("should preserve downstream paths (no path renaming)", () => {
    expect(content).toContain('"/orgs/google/auth/start"');
    expect(content).toContain('/orgs/google/auth/callback');
    expect(content).toContain('"/orgs/google/sync"');
    expect(content).toContain('/orgs/google/messages');
    expect(content).toContain('/orgs/google/contacts');
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

  it("should register GET /v1/orgs/google/messages", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/messages"');
    expect(schemaContent).toContain("GoogleMessagesResponse");
  });

  it("should register GET /v1/orgs/google/contacts", () => {
    expect(schemaContent).toContain('path: "/v1/orgs/google/contacts"');
    expect(schemaContent).toContain("GoogleContactsResponse");
  });

  it("should use Google CRM tag", () => {
    expect(schemaContent).toContain('tags: ["Google CRM"]');
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
