import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("OpenAPI spec — ErrorSummary on failed runs", () => {
  const spec = JSON.parse(
    readFileSync(resolve(__dirname, "../../openapi.json"), "utf-8"),
  );

  it("defines the ErrorSummary schema with failedStep, message, rootCause", () => {
    const errorSummary = spec.components.schemas.ErrorSummary;
    expect(errorSummary).toBeDefined();
    expect(errorSummary.properties.failedStep).toBeDefined();
    expect(errorSummary.properties.message).toBeDefined();
    expect(errorSummary.properties.rootCause).toBeDefined();
    expect(errorSummary.required).toEqual(
      expect.arrayContaining(["failedStep", "message", "rootCause"]),
    );
  });

  it("includes error and errorSummary as optional fields on RunCostData", () => {
    const runCostData = spec.components.schemas.RunCostData;
    expect(runCostData).toBeDefined();
    expect(runCostData.properties.errorSummary).toBeDefined();
    expect(runCostData.properties.error).toBeDefined();
    // Neither should be required — only present on failed runs
    expect(runCostData.required).not.toContain("errorSummary");
    expect(runCostData.required).not.toContain("error");
  });
});
