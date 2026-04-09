/**
 * Regression test: silent .default() on limit/pageSize/per_page query params
 * caused callers to receive truncated results without knowing it.
 * Reference: outlets-service PR #76 / hotfix v0.2.1
 *
 * Rule: list/query endpoints (GET) must NEVER have a default or max on
 * pagination params. If a caller doesn't pass limit, they get all results.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const specPath = path.join(__dirname, "../../openapi.json");
const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));

const PAGINATION_PARAM_NAMES = new Set([
  "limit",
  "pageSize",
  "page_size",
  "per_page",
  "count",
]);

// Write paths where a default count is intentional (discovery, buffering, etc.)
const EXEMPT_ENDPOINTS = new Set([
  "POST /v1/outlets/discover",
  "POST /v1/outlets/buffer",
  "POST /v1/leads/search",
  "POST /v1/articles/search",
]);

describe("No silent limit defaults on list endpoints", () => {
  const violations: string[] = [];

  for (const [p, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(
      methods as Record<string, any>,
    )) {
      if (method === "parameters") continue;
      const key = `${method.toUpperCase()} ${p}`;
      if (EXEMPT_ENDPOINTS.has(key)) continue;

      const params: any[] = operation.parameters ?? [];
      for (const param of params) {
        if (
          (param.in === "query" || param.in === "body") &&
          PAGINATION_PARAM_NAMES.has(param.name)
        ) {
          if (param.schema?.default !== undefined) {
            violations.push(`${key} — param "${param.name}" has default: ${param.schema.default}`);
          }
          if (param.schema?.maximum !== undefined) {
            violations.push(`${key} — param "${param.name}" has maximum: ${param.schema.maximum}`);
          }
        }
      }

      // Also check requestBody schemas for POST endpoints
      const bodySchema =
        operation.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema?.properties) {
        for (const [propName, propSchema] of Object.entries(
          bodySchema.properties as Record<string, any>,
        )) {
          if (!PAGINATION_PARAM_NAMES.has(propName)) continue;
          if (propSchema.default !== undefined) {
            violations.push(`${key} — body field "${propName}" has default: ${propSchema.default}`);
          }
          if (propSchema.maximum !== undefined) {
            violations.push(`${key} — body field "${propName}" has maximum: ${propSchema.maximum}`);
          }
        }
      }
    }
  }

  it("no pagination param should have a silent default", () => {
    const defaultViolations = violations.filter((v) => v.includes("has default"));
    expect(defaultViolations).toEqual([]);
  });

  it("no pagination param should have a hidden maximum", () => {
    const maxViolations = violations.filter((v) => v.includes("has maximum"));
    expect(maxViolations).toEqual([]);
  });
});
