import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Prompts proxy route — GET /prompts", () => {
  const routePath = path.join(__dirname, "../../src/routes/prompts.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should define GET /prompts", () => {
    expect(content).toContain('router.get("/prompts"');
  });

  it("should require type query parameter", () => {
    const getStart = content.indexOf('router.get("/prompts"');
    const getEnd = content.indexOf("router.", getStart + 10);
    const block = content.slice(getStart, getEnd);

    expect(block).toContain("req.query.type");
    expect(block).toContain("400");
    expect(block).toContain("Missing required query parameter: type");
  });

  it("should proxy to content-generation /prompts?type=", () => {
    expect(content).toContain("externalServices.emailgen");
    expect(content).toContain("/prompts?type=");
  });

  it("should URL-encode the type parameter", () => {
    expect(content).toContain("encodeURIComponent(type)");
  });

  it("should use authenticate, requireOrg, requireUser middleware", () => {
    const getLine = content.slice(
      content.indexOf('router.get("/prompts"'),
      content.indexOf('router.get("/prompts"') + 100
    );
    expect(getLine).toContain("authenticate");
    expect(getLine).toContain("requireOrg");
    expect(getLine).toContain("requireUser");
  });
});

describe("Prompts proxy route — PUT /prompts", () => {
  const routePath = path.join(__dirname, "../../src/routes/prompts.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should define PUT /prompts", () => {
    expect(content).toContain('router.put("/prompts"');
  });

  it("should validate body with VersionPromptRequestSchema", () => {
    const putStart = content.indexOf('router.put("/prompts"');
    const putEnd = content.length;
    const block = content.slice(putStart, putEnd);

    expect(block).toContain("VersionPromptRequestSchema");
    expect(block).toContain("safeParse");
  });

  it("should proxy to content-generation PUT /prompts", () => {
    const putStart = content.indexOf('router.put("/prompts"');
    const block = content.slice(putStart);

    expect(block).toContain("externalServices.emailgen");
    expect(block).toContain('method: "PUT"');
    expect(block).toContain('"/prompts"');
  });

  it("should return 201 on success", () => {
    const putStart = content.indexOf('router.put("/prompts"');
    const block = content.slice(putStart);

    expect(block).toContain("res.status(201)");
  });

  it("should return 400 on invalid body", () => {
    const putStart = content.indexOf('router.put("/prompts"');
    const block = content.slice(putStart);

    expect(block).toContain("400");
    expect(block).toContain("Invalid request");
  });
});

describe("Prompts OpenAPI schemas", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should register GET /v1/prompts path", () => {
    expect(content).toContain('path: "/v1/prompts"');
    expect(content).toContain('method: "get"');
  });

  it("should register PUT /v1/prompts path", () => {
    expect(content).toContain('path: "/v1/prompts"');
    expect(content).toContain('method: "put"');
  });

  it("should define PromptResponse schema", () => {
    expect(content).toContain('"PromptResponse"');
    expect(content).toContain("variables");
    expect(content).toContain("prompt");
  });

  it("should define VersionPromptRequest schema", () => {
    expect(content).toContain('"VersionPromptRequest"');
    expect(content).toContain("sourceType");
  });

  it("should export VersionPromptRequestSchema", () => {
    expect(content).toContain("export const VersionPromptRequestSchema");
  });
});

describe("Prompts routes mounted in index.ts", () => {
  const indexPath = path.join(__dirname, "../../src/index.ts");
  const content = fs.readFileSync(indexPath, "utf-8");

  it("should import prompts routes", () => {
    expect(content).toContain("promptsRoutes");
    expect(content).toContain("./routes/prompts");
  });

  it("should mount prompts routes under /v1", () => {
    expect(content).toContain('app.use("/v1", promptsRoutes)');
  });
});
