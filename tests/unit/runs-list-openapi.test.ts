import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("OpenAPI spec — GET /v1/runs response shape", () => {
  const spec = JSON.parse(
    readFileSync(resolve(__dirname, "../../openapi.json"), "utf-8"),
  );

  const listRuns = spec.paths["/v1/runs"].get;
  const responseRef: string =
    listRuns.responses["200"].content["application/json"].schema.$ref;
  const responseSchemaName = responseRef.replace("#/components/schemas/", "");
  const responseSchema = spec.components.schemas[responseSchemaName];
  const runsRef: string = responseSchema.properties.runs.items.$ref;
  const runSchemaName = runsRef.replace("#/components/schemas/", "");
  const runSchema = spec.components.schemas[runSchemaName];

  it("references a schema that is NOT the per-cost-name RunCostData", () => {
    expect(runSchemaName).not.toBe("RunCostData");
  });

  it("each run includes id as a required uuid field", () => {
    expect(runSchema.properties.id).toBeDefined();
    expect(runSchema.properties.id.format).toBe("uuid");
    expect(runSchema.required).toContain("id");
  });

  it("each run includes ownCostInUsdCents as a required field", () => {
    expect(runSchema.properties.ownCostInUsdCents).toBeDefined();
    expect(runSchema.required).toContain("ownCostInUsdCents");
  });

  it("each run does NOT include costs[] (only on GET /v1/runs/{id})", () => {
    expect(runSchema.properties.costs).toBeUndefined();
  });

  it("each run does NOT include totalCostInUsdCents (only on GET /v1/runs/{id})", () => {
    expect(runSchema.properties.totalCostInUsdCents).toBeUndefined();
  });

  it("each run does NOT include descendantRuns (only on GET /v1/runs/{id})", () => {
    expect(runSchema.properties.descendantRuns).toBeUndefined();
  });

  it("operation description documents default sort startedAt DESC", () => {
    expect(listRuns.description).toMatch(/startedAt DESC/i);
  });

  it("RunCostData schema is still defined (used by other endpoints)", () => {
    expect(spec.components.schemas.RunCostData).toBeDefined();
    expect(spec.components.schemas.RunCostData.properties.costs).toBeDefined();
  });
});
