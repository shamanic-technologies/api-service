import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/journalists.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Journalists proxy routes", () => {
  it("should have POST /journalists/discover with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/journalists/discover"') && !l.includes("emails")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have POST /journalists/discover-emails with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/journalists/discover-emails"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have POST /journalists/resolve with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/journalists/resolve"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should NOT have stale /campaign-outlet-journalists endpoint", () => {
    expect(content).not.toContain("/campaign-outlet-journalists");
  });

  it("should use buildInternalHeaders for all endpoints", () => {
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(3);
  });

  it("should proxy to externalServices.journalist", () => {
    expect(content).toContain("externalServices.journalist");
  });

  it("should forward request body on all POST endpoints", () => {
    const bodyMatches = content.match(/body: req\.body/g);
    expect(bodyMatches).not.toBeNull();
    expect(bodyMatches!.length).toBe(3);
  });

  it("should enforce requireOrg + requireUser on ALL journalist routes", () => {
    const routeLines = content.split("\n").filter((l) =>
      /router\.(get|post|patch)\(/.test(l) && l.includes('"/')
    );
    expect(routeLines.length).toBeGreaterThan(0);
    for (const line of routeLines) {
      expect(line).toContain("authenticate");
      expect(line).toContain("requireOrg");
      expect(line).toContain("requireUser");
    }
  });
});

describe("Journalists service client", () => {
  it("should have journalist in externalServices", () => {
    expect(serviceClientContent).toContain("journalist:");
    expect(serviceClientContent).toContain("JOURNALISTS_SERVICE_URL");
    expect(serviceClientContent).toContain("JOURNALISTS_SERVICE_API_KEY");
  });
});

describe("Journalists OpenAPI schemas", () => {
  it("should register POST /v1/journalists/discover", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/discover"');
    expect(schemaContent).toContain("DiscoverJournalistsRequest");
    expect(schemaContent).toContain("DiscoverJournalistsResponse");
  });

  it("should register POST /v1/journalists/discover-emails", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/discover-emails"');
    expect(schemaContent).toContain("DiscoverEmailsRequest");
    expect(schemaContent).toContain("DiscoverEmailsResponse");
  });

  it("should register POST /v1/journalists/resolve", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/resolve"');
    expect(schemaContent).toContain("ResolveJournalistsRequest");
    expect(schemaContent).toContain("ResolveJournalistsResponse");
  });

  it("should use Journalists tag", () => {
    expect(schemaContent).toContain('tags: ["Journalists"]');
  });

  it("should define journalist entity type enum", () => {
    expect(schemaContent).toContain('"individual"');
    expect(schemaContent).toContain('"organization"');
  });
});

describe("Journalists routes are mounted in index.ts", () => {
  it("should import and mount journalists routes", () => {
    expect(indexContent).toContain("journalistsRoutes");
    expect(indexContent).toContain("./routes/journalists");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", journalistsRoutes)');
  });
});
