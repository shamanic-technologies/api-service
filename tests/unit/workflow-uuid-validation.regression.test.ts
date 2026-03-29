import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression test: non-UUID strings like "new" must NOT be forwarded to
 * workflow-service as a workflow ID.  Without validation, Express captures
 * "new" via the `:id` param and workflow-service blows up with
 * `PostgresError: invalid input syntax for type uuid: "new"`.
 */
describe("Workflow :id routes validate UUID format", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should define a UUID regex or validation helper", () => {
    expect(content).toMatch(/UUID_RE|isUUID/);
  });

  const idRoutes = [
    '/workflows/:id/summary"',
    '/workflows/:id/key-status"',
    '/workflows/:id/validate"',
    '/workflows/:id"',  // GET and PUT
    '/workflows/:id/execute"',
    '/workflow-runs/:id"',
    '/workflow-runs/:id/cancel"',
  ];

  for (const route of idRoutes) {
    it(`should validate UUID on route containing ${route}`, () => {
      // Find handler block for this route
      const idx = content.indexOf(route);
      expect(idx).toBeGreaterThan(-1);
      // Check that isUUID appears between this route and the next route or end
      const nextRouteIdx = content.indexOf("router.", idx + 1);
      const block = content.slice(idx, nextRouteIdx > idx ? nextRouteIdx : undefined);
      expect(block).toContain("isUUID");
    });
  }
});

describe("Workflow OpenAPI schemas use uuid format for {id} param", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("WorkflowIdParam should use z.string().uuid()", () => {
    const section = content.slice(
      content.indexOf("WorkflowIdParam"),
      content.indexOf("WorkflowIdParam") + 100,
    );
    expect(section).toContain(".uuid()");
  });

  it("GET /v1/workflows/{id} inline param should use .uuid()", () => {
    const start = content.indexOf('path: "/v1/workflows/{id}"');
    // Find the next path definition to bound the search
    const nextPath = content.indexOf("path:", start + 1);
    const getSection = content.slice(start, nextPath > start ? nextPath : start + 500);
    expect(getSection).toContain(".uuid()");
  });
});
