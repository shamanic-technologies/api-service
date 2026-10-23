import { describe, it, expect, vi, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { buildDocument, HTTP_METHODS, ONBOARDING_OPERATIONS } from "../../src/openapi/document.js";
import { isEmptyBodySchema } from "../../src/openapi/downstream-bodies.js";
import { DOWNSTREAM_RESPONSE_SOURCES, DOWNSTREAM_RESPONSE_SNAPSHOT } from "../../src/openapi/downstream-responses.js";

/**
 * API-ONBOARD-DOC-1023: an AI agent with a fresh customer key reads ONE document
 * and knows how to open a client's account end to end. Before: the document it
 * was pointed to was 6.3 MB (6.9 MB served), answer shapes were empty objects
 * (an agent created a brand and never learned its id), and the Quick Start told
 * an agent that had just got its key to "create an API key in the dashboard".
 */

type Json = Record<string, any>;

vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    authenticateUser: (req: any, _res: any, next: any) => {
      req.userId = "22222222-2222-4222-8222-222222222222";
      req.orgId = "11111111-1111-4111-8111-111111111111";
      req.authType = "user_key";
      req.userKeyScope = { isStaff: false, memberships: [], email: "client@acme.com", displayName: "Ada" };
      next();
    },
  };
});

import meRouter from "../../src/routes/me.js";

const full = buildDocument();
const onboarding = buildDocument({ view: "onboarding" });
const size = (doc: unknown) => JSON.stringify(doc).length;

function operationKeys(doc: Json): string[] {
  const out: string[] = [];
  for (const [path, item] of Object.entries(doc.paths as Json)) {
    for (const m of HTTP_METHODS) if ((item as Json)[m]) out.push(`${m.toUpperCase()} ${path}`);
  }
  return out;
}

function successSchemas(doc: Json, key: string): Json[] {
  const [method, path] = key.split(" ");
  const op = doc.paths[path][method.toLowerCase()];
  return Object.entries(op.responses as Json)
    .filter(([code]) => code.startsWith("2"))
    .map(([, r]) => (r as Json).content?.["application/json"]?.schema)
    .filter(Boolean);
}

describe("document size an agent can read", () => {
  it("the full customer document stays under 1.5 MB (6.3 MB before shared components)", () => {
    expect(size(full)).toBeLessThan(1_500_000);
  });

  it("the onboarding view stays under 250 KB", () => {
    expect(size(onboarding)).toBeLessThan(250_000);
  });
});

describe("?view=onboarding: the first-client path, in order", () => {
  it("lists exactly ONBOARDING_OPERATIONS, every one a customer operation", () => {
    const fullKeys = new Set(operationKeys(full));
    for (const key of ONBOARDING_OPERATIONS) expect(fullKeys.has(key), `${key} is not in the customer document`).toBe(true);
    expect(operationKeys(onboarding).sort()).toEqual([...ONBOARDING_OPERATIONS].sort());
  });

  it("every $ref in the onboarding view resolves inside it", () => {
    const broken: string[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const ref = (node as Json).$ref;
      if (typeof ref === "string") {
        const [, , section, name] = ref.split("/");
        if (!(onboarding.components as Json)?.[section]?.[name]) broken.push(ref);
      }
      Object.values(node).forEach(visit);
    };
    visit(onboarding);
    expect(broken).toEqual([]);
  });

  it("every onboarding operation documents what it answers (no empty shape)", () => {
    const empty = ONBOARDING_OPERATIONS.filter((key) => {
      const schemas = successSchemas(full, key);
      return schemas.length === 0 || schemas.every((s) => isEmptyBodySchema(full, s));
    });
    expect(empty).toEqual([]);
  });

  it("creating a brand documents the brandId it returns (brand-service's served shape)", () => {
    const [schema] = successSchemas(full, "POST /v1/brands");
    expect(Object.keys(schema.properties)).toContain("brandId");
  });

  it("confirming offers documents the offerId of each offer created (brand-service's served shape)", () => {
    const [schema] = successSchemas(full, "POST /v1/brands/{id}/offers/confirm");
    const offer = schema.properties.offers.items;
    expect(Object.keys(offer.properties)).toContain("offerId");
  });

  it("every response source maps to a registered operation and has a snapshot", () => {
    const staffKeys = new Set(operationKeys(buildDocument({ audience: "staff" })));
    for (const key of Object.keys(DOWNSTREAM_RESPONSE_SOURCES)) {
      expect(staffKeys.has(key), `${key} is mapped but not registered`).toBe(true);
      expect(DOWNSTREAM_RESPONSE_SNAPSHOT[key], `${key}: run scripts/sync-downstream-bodies.ts`).toBeDefined();
    }
  });
});

describe("Quick Start", () => {
  const description = (full.info as Json).description as string;

  it("states the first-client path in order and points to the skills", () => {
    const order = ["GET /v1/me", "POST /v1/brands", "/offers/proposals", "/offers/confirm", "/v1/orgs/audiences/suggest", "/v1/content/preview-email", "prepaid_checkout", "POST /v1/sales-funnel-campaigns", "PATCH /v1/sales-funnel-campaigns/{id}"];
    const at = order.map((s) => description.indexOf(s));
    expect(at.every((i) => i >= 0), JSON.stringify(order.filter((_, i) => at[i] < 0))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(description).toContain("GET /v1/skills");
    expect(description).toContain("?view=onboarding");
  });

  it("never tells an agent that just signed up to create a key in the dashboard", () => {
    expect(description).not.toMatch(/1\. Create an API key in the/);
  });
});

describe("only what a customer key may call", () => {
  // Drive the REAL app's router stacks: an operation whose route requires the
  // platform key is refused to every customer key, so it must not be documented.
  let server: { close: () => void } | undefined;
  afterAll(() => server?.close());

  it("no customer-document operation sits behind authenticatePlatform", async () => {
    process.env.PORT = "0";
    const mod = (await import("../../src/index.js")) as unknown as { default: any; server: { close: () => void } };
    server = mod.server;
    const chains = new Map<string, string[]>();
    const walk = (stack: any[], prefix: string) => {
      for (const layer of stack) {
        if (layer.route) {
          const names = layer.route.stack.map((l: any) => l.name);
          for (const m of Object.keys(layer.route.methods)) {
            const key = `${m.toUpperCase()} ${(prefix + layer.route.path).replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`;
            if (!chains.has(key)) chains.set(key, names);
          }
        } else if (layer.name === "router" && layer.handle?.stack) {
          const src: string = layer.regexp?.source ?? "";
          const m = src.match(/^\^\\\/([a-z0-9-]+)/);
          walk(layer.handle.stack, prefix + (m && !src.startsWith("^\\/?") ? `/${m[1]}` : ""));
        }
      }
    };
    walk(mod.default._router.stack, "");
    expect(chains.size).toBeGreaterThan(400);
    const refused = operationKeys(full).filter((key) => chains.get(key)?.includes("authenticatePlatform"));
    expect(refused).toEqual([]);
  });
});

describe("GET /v1/me/openapi.json?view=", () => {
  const app = express().use("/v1", meRouter);
  const auth = { Authorization: "Bearer distrib.usr_abcdefghijklmnopqrstuvwxyz0123456789" };

  it("onboarding serves only the first-client operations", async () => {
    const res = await request(app).get("/v1/me/openapi.json?view=onboarding").set(auth);
    expect(res.status).toBe(200);
    expect(operationKeys(res.body).sort()).toEqual([...ONBOARDING_OPERATIONS].sort());
    expect(res.headers.etag).toMatch(/^W\//);
  });

  it("no view serves the full document", async () => {
    const res = await request(app).get("/v1/me/openapi.json").set(auth);
    expect(operationKeys(res.body).length).toBe(operationKeys(full).length);
  });

  it("an unknown view is refused, never silently swapped", async () => {
    const res = await request(app).get("/v1/me/openapi.json?view=short").set(auth);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_view");
  });
});
