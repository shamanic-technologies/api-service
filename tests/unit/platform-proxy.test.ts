import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const platformRoutePath = path.join(__dirname, "../../src/routes/platform.ts");
const content = fs.readFileSync(platformRoutePath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const envExamplePath = path.join(__dirname, "../../.env.example");
const envContent = fs.readFileSync(envExamplePath, "utf-8");

describe("Platform proxy routes", () => {
  it("should have GET /platform/services endpoint", () => {
    expect(content).toContain('"/platform/services"');
    expect(content).toContain("router.get");
  });

  it("should have GET /platform/services/:service endpoint", () => {
    expect(content).toContain('"/platform/services/:service"');
  });

  it("should have GET /platform/llm-context endpoint", () => {
    expect(content).toContain('"/platform/llm-context"');
  });

  it("should use authenticate, requireOrg, requireUser on all endpoints", () => {
    const routeLines = content.split("\n").filter((l) => l.includes("router.get"));
    expect(routeLines.length).toBe(3);
    for (const line of routeLines) {
      expect(line).toContain("authenticate");
      expect(line).toContain("requireOrg");
      expect(line).toContain("requireUser");
    }
  });

  it("should proxy /platform/services to api-registry /services", () => {
    expect(content).toContain('"/services"');
    expect(content).toContain("externalServices.apiRegistry");
  });

  it("should proxy /platform/services/:service to api-registry /openapi/:service", () => {
    expect(content).toContain("`/openapi/${service}`");
  });

  it("should proxy /platform/llm-context to api-registry /llm-context", () => {
    expect(content).toContain('"/llm-context"');
  });

  it("should use buildInternalHeaders for identity forwarding", () => {
    expect(content).toContain("buildInternalHeaders");
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(3);
  });

  it("should forward upstream status codes on error", () => {
    expect(content).toContain("error.statusCode || 500");
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
