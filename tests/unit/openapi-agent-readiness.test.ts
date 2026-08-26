import { describe, it, expect } from "vitest";
import {
  buildDocument,
  deriveOperationId,
  postProcessOperations,
  HTTP_METHODS,
} from "../../src/openapi/document.js";

/**
 * The agent-readiness contract of the published OpenAPI document.
 *
 * These assertions are what stops the fix from being a one-time sweep: the doc
 * is generated from `registry.definitions`, so an operation added next month
 * inherits the post-processing — and if anything breaks that (an explicit
 * duplicate operationId, an operation registered with no inputs and no way to
 * type it), the build fails here rather than silently regressing the audit.
 */

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

function operations(document: Record<string, unknown>): Array<{
  method: string;
  path: string;
  operation: Operation;
}> {
  const paths = document.paths as Record<string, Record<string, unknown>>;
  const out: Array<{ method: string; path: string; operation: Operation }> = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method] as Operation | undefined;
      if (operation) out.push({ method, path, operation });
    }
  }
  return out;
}

const document = buildDocument();
const ops = operations(document);

describe("OpenAPI — machine-readable identity", () => {
  it("has operations", () => {
    expect(ops.length).toBeGreaterThan(200);
  });

  it("gives EVERY operation an operationId", () => {
    const missing = ops
      .filter((o) => !o.operation.operationId)
      .map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(missing).toEqual([]);
  });

  it("keeps every operationId unique", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const { method, path, operation } of ops) {
      const id = operation.operationId!;
      const prior = seen.get(id);
      if (prior) duplicates.push(`${id}: ${prior} vs ${method.toUpperCase()} ${path}`);
      seen.set(id, `${method.toUpperCase()} ${path}`);
    }
    expect(duplicates).toEqual([]);
  });

  it("uses operationIds that are valid function-call tool names", () => {
    // Lower camelCase, alphanumeric only — safe as an LLM tool name and as an
    // identifier in every generated client.
    const bad = ops
      .map((o) => o.operation.operationId!)
      .filter((id) => !/^[a-z][A-Za-z0-9]*$/.test(id));
    expect(bad).toEqual([]);
  });

  it("gives EVERY operation a description or summary", () => {
    const missing = ops
      .filter((o) => !o.operation.description && !o.operation.summary)
      .map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(missing).toEqual([]);
  });
});

describe("OpenAPI — typed schemas", () => {
  it("gives EVERY operation typed inputs (parameters and/or a request body)", () => {
    const untyped = ops
      .filter((o) => !(o.operation.parameters?.length || o.operation.requestBody))
      .map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(untyped).toEqual([]);
  });

  it("gives every declared parameter a schema", () => {
    const bad: string[] = [];
    for (const { method, path, operation } of ops) {
      for (const param of (operation.parameters ?? []) as Array<{
        name?: string;
        schema?: unknown;
        $ref?: string;
      }>) {
        if (!param.schema && !param.$ref) {
          bad.push(`${method.toUpperCase()} ${path} — ${param.name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives EVERY operation at least one response with a typed body", () => {
    const untyped = ops
      .filter(({ operation }) => {
        const responses = Object.values(operation.responses ?? {});
        return !responses.some((r) =>
          Object.values(r.content ?? {}).some((c) => c.schema),
        );
      })
      .map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(untyped).toEqual([]);
  });
});

describe("OpenAPI — rate-limit documentation", () => {
  it("documents a 429 on every operation", () => {
    const missing = ops
      .filter((o) => !o.operation.responses?.["429"])
      .map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(missing).toEqual([]);
  });

  it("documents Retry-After on every 429", () => {
    const missing = ops
      .filter((o) => {
        const headers = (o.operation.responses?.["429"] as { headers?: Record<string, unknown> })
          ?.headers;
        return !headers?.["Retry-After"];
      })
      .map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(missing).toEqual([]);
  });

  it("documents the RateLimit headers on every response of every operation", () => {
    const missing: string[] = [];
    for (const { method, path, operation } of ops) {
      for (const [code, response] of Object.entries(operation.responses ?? {})) {
        const headers = (response as { headers?: Record<string, unknown> }).headers ?? {};
        for (const name of ["RateLimit", "RateLimit-Policy", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"]) {
          if (!headers[name]) missing.push(`${method.toUpperCase()} ${path} ${code} — ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("describes the rate-limit policy in the document description", () => {
    const description = (document.info as { description: string }).description;
    expect(description).toContain("## Rate limits");
    expect(description).toContain("RateLimit-Policy");
    expect(description).toContain("Retry-After");
  });
});

describe("OpenAPI — deprecation policy", () => {
  it("publishes a machine-readable deprecation policy at the document root", () => {
    const policy = document["x-deprecation-policy"] as Record<string, unknown>;
    expect(policy).toBeDefined();
    expect(policy.minimumNoticeDays).toBeGreaterThanOrEqual(90);
    expect(policy.versioning).toBe("url-path");
    expect(policy.currentVersion).toBe("v1");
    expect(policy.signals).toMatchObject({
      deprecationHeader: expect.stringContaining("Deprecation"),
      sunsetHeader: expect.stringContaining("Sunset"),
    });
  });

  it("describes the deprecation policy in the document description", () => {
    const description = (document.info as { description: string }).description;
    expect(description).toContain("## Deprecation policy");
    expect(description).toContain("Sunset");
    expect(description).toContain("RFC 9745");
  });

  it("documents the Deprecation / Sunset / Link headers on every response", () => {
    const missing: string[] = [];
    for (const { method, path, operation } of ops) {
      for (const [code, response] of Object.entries(operation.responses ?? {})) {
        const headers = (response as { headers?: Record<string, unknown> }).headers ?? {};
        for (const name of ["Deprecation", "Sunset", "Link"]) {
          if (!headers[name]) missing.push(`${method.toUpperCase()} ${path} ${code} — ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("deriveOperationId", () => {
  it("is a lossless, stable function of method + path", () => {
    expect(deriveOperationId("get", "/")).toBe("getRoot");
    expect(deriveOperationId("get", "/health")).toBe("getHealth");
    expect(deriveOperationId("get", "/openapi.json")).toBe("getOpenapiJson");
    expect(deriveOperationId("get", "/v1/campaigns/{id}/stats")).toBe("getV1CampaignsByIdStats");
    expect(deriveOperationId("post", "/v1/orgs/audiences/{id}/refresh-count")).toBe(
      "postV1OrgsAudiencesByIdRefreshCount",
    );
    expect(deriveOperationId("get", "/v1/costs/platform-prices")).toBe("getV1CostsPlatformPrices");
  });

  it("distinguishes paths that differ only in the parameter name", () => {
    expect(deriveOperationId("get", "/v1/x/{id}")).not.toBe(deriveOperationId("get", "/v1/x/{brandId}"));
  });
});

describe("postProcessOperations", () => {
  it("throws on a duplicate operationId rather than shipping a colliding tool name", () => {
    const doc = {
      paths: {
        "/a": { get: { operationId: "collide", responses: {} } },
        "/b": { get: { operationId: "collide", responses: {} } },
      },
    };
    expect(() => postProcessOperations(doc)).toThrow(/Duplicate operationId "collide"/);
  });

  it("keeps an explicitly declared operationId", () => {
    const doc = { paths: { "/a": { get: { operationId: "customName", responses: {} } } } };
    postProcessOperations(doc);
    expect((doc.paths["/a"].get as { operationId: string }).operationId).toBe("customName");
  });

  it("adds the correlation-id parameter to an operation that has none", () => {
    const doc = { paths: { "/a": { get: { responses: {} } } } } as Record<string, unknown>;
    postProcessOperations(doc);
    const params = ((doc.paths as any)["/a"].get.parameters ?? []) as Array<{ name: string }>;
    expect(params.map((p) => p.name)).toContain("x-request-id");
  });

  it("adds identity header parameters only to secured operations", () => {
    const doc = {
      paths: {
        "/secured": { get: { security: [{ bearerAuth: [] }], responses: {} } },
        "/public": { get: { responses: {} } },
      },
    } as Record<string, unknown>;
    postProcessOperations(doc);
    const names = (p: string) =>
      (((doc.paths as any)[p].get.parameters ?? []) as Array<{ name: string }>).map((x) => x.name);
    expect(names("/secured")).toContain("x-org-id");
    expect(names("/public")).not.toContain("x-org-id");
    expect(names("/public")).toContain("x-request-id");
  });
});
