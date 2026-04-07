import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/leads.ts");
const routeContent = fs.readFileSync(routePath, "utf-8");

const openapiPath = path.join(__dirname, "../../openapi.json");
const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

describe("replyClassification on GET /v1/leads", () => {
  it("should read replyClassification directly from lead object (not from a status merge)", () => {
    expect(routeContent).toContain("raw.replyClassification");
    expect(routeContent).not.toContain("delivery?.replyClassification");
  });

  it("should include replyClassification in the OpenAPI response schema", () => {
    const schema =
      openapi.components?.schemas?.BrandLeadsResponse;
    expect(schema).toBeDefined();

    const leadProps = schema.properties.leads.items.properties;
    expect(leadProps.replyClassification).toBeDefined();
    expect(leadProps.replyClassification.nullable).toBe(true);
  });
});
