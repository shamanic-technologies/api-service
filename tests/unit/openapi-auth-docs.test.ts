import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildDocument } from "../../src/openapi/document.js";

const schemasPath = path.join(__dirname, "../../src/schemas.ts");
const schemasContent = fs.readFileSync(schemasPath, "utf-8");

// Assert against the document the build produces rather than the source of the
// generator: the generator moved from `scripts/` to `src/openapi/document.ts`
// and every source-substring assertion here would have gone green on a file
// that no longer builds anything.
const document = buildDocument();
const info = document.info as { description: string };
const description = info.description;
const servers = document.servers as Array<{ url: string }>;

/** Every operation in the built document. */
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const operations = Object.entries(
  document.paths as Record<string, Record<string, any>>,
).flatMap(([p, item]) =>
  HTTP_METHODS.filter((m) => item[m]).map((m) => ({ method: m, path: p, operation: item[m] })),
);

describe("OpenAPI spec — auth documentation", () => {
  it("should document user key as the default in security scheme", () => {
    expect(schemasContent).toContain("distrib.usr_*");
    expect(schemasContent).toContain("POST /v1/api-keys");
  });

  it("should not reference Platform section or app registration", () => {
    expect(schemasContent).not.toContain("Platform section");
    expect(schemasContent).not.toContain("/v1/apps/register");
  });
});

describe("OpenAPI spec — info description", () => {
  it("should include Quick Start section in API description", () => {
    expect(description).toContain("## Quick Start");
  });

  it("should document user key flow with example", () => {
    expect(description).toContain("Authorization: Bearer distrib.usr_abc123");
  });

  it("should include BYOK section without keySource", () => {
    expect(description).toContain("## Storing provider keys (BYOK)");
    expect(description).not.toContain('"keySource"');
  });

  it("should document error codes for auth failures", () => {
    expect(description).toContain("org_target_required");
    expect(description).toContain("Identity resolution failed");
  });

  it("should not include Advanced: Platform integration section", () => {
    expect(description).not.toContain("## Advanced: Platform integration");
    expect(description).not.toContain("/v1/apps/register");
  });
});

describe("OpenAPI spec — server URL", () => {
  it("should default to api.distribute.you", () => {
    expect(servers[0].url).toBe(process.env.SERVICE_URL || "https://api.distribute.you");
  });
});

describe("OpenAPI spec — identity header parameters on authenticated endpoints", () => {
  // Shared header parameters are `$ref`s to components.parameters (declared once).
  const shared = ((document.components as any)?.parameters ?? {}) as Record<string, { name: string; in: string }>;
  const paramNames = (op: any) =>
    ((op.parameters ?? []) as Array<{ name?: string; in?: string; $ref?: string }>).map((p) => {
      const resolved = p.$ref ? shared[p.$ref.split("/").pop()!] : p;
      return `${resolved.in}:${resolved.name}`;
    });

  it("should inject the x-org-id and x-brand-id header parameters a customer key may send", () => {
    const secured = operations.filter((o) => o.operation.security?.length);
    expect(secured.length).toBeGreaterThan(0);
    for (const { method, path: p, operation } of secured) {
      const names = paramNames(operation);
      expect(names, `${method.toUpperCase()} ${p}`).toContain("header:x-org-id");
      expect(names, `${method.toUpperCase()} ${p}`).toContain("header:x-brand-id");
      // Set by our own apps and workflow-service, never by a key holder: staff document only.
      expect(names, `${method.toUpperCase()} ${p}`).not.toContain("header:x-user-id");
    }
  });

  it("the staff document still documents every identity header", () => {
    const staff = buildDocument({ audience: "staff" });
    const params = Object.values(((staff.components as any).parameters ?? {}) as Record<string, { name: string }>).map((p) => p.name);
    expect(params).toEqual(expect.arrayContaining(["x-org-id", "x-user-id", "x-campaign-id", "x-brand-id", "x-workflow-slug", "x-feature-slug"]));
  });

  it("should only add identity headers to operations that have security defined", () => {
    const unsecured = operations.filter((o) => !o.operation.security?.length);
    expect(unsecured.length).toBeGreaterThan(0);
    for (const { method, path: p, operation } of unsecured) {
      expect(paramNames(operation), `${method.toUpperCase()} ${p}`).not.toContain("header:x-org-id");
    }
  });

  it("should preserve an operation's own parameters when adding identity headers", () => {
    // A path-parameter operation keeps its path parameter alongside the injected headers.
    const withPathParam = operations.find((o) => o.path.includes("{") && o.operation.security?.length);
    expect(withPathParam).toBeDefined();
    const names = paramNames(withPathParam!.operation);
    expect(names.some((n) => n.startsWith("path:"))).toBe(true);
    expect(names).toContain("header:x-org-id");
  });
});

describe("OpenAPI spec — tag structure", () => {
  it("should use Authentication tag for API key endpoints", () => {
    expect(schemasContent).toContain('tags: ["Authentication"]');
  });

  it("should have Platform tag for api-registry proxy endpoints", () => {
    expect(schemasContent).toContain('tags: ["Platform"]');
  });

  it("should define Authentication tag before Keys tag", () => {
    const tags = (document.tags as Array<{ name: string }>).map((t) => t.name);
    expect(tags.indexOf("Authentication")).toBeGreaterThanOrEqual(0);
    expect(tags.indexOf("Authentication")).toBeLessThan(tags.indexOf("Keys"));
  });
});

describe("OpenAPI spec — keySource clarity", () => {
  it("should not have keySource in UpsertKeyRequestSchema (route hardcodes it)", () => {
    const upsertBlock = schemasContent.slice(
      schemasContent.indexOf("UpsertKeyRequestSchema"),
      schemasContent.indexOf("UpsertKeyRequestSchema") + 300,
    );
    // keySource is no longer in the public schema — the route hardcodes "org"
    expect(upsertBlock).not.toContain("keySource");
  });
});
