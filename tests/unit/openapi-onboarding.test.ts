import { describe, it, expect, vi, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { buildDocument, HTTP_METHODS } from "../../src/openapi/document.js";
import { isEmptyBodySchema } from "../../src/openapi/downstream-bodies.js";
import { DOWNSTREAM_RESPONSE_SOURCES, DOWNSTREAM_RESPONSE_SNAPSHOT } from "../../src/openapi/downstream-responses.js";
import {
  ONBOARDING_OPERATIONS,
  ONBOARDING_STEPS,
  parseSelection,
  selectDocument,
  tagPages,
  isSelectionError,
} from "../../src/openapi/views.js";

/**
 * API-ONBOARD-DOC-1023: an AI agent with a fresh customer key reads the API in
 * pieces it can hold. The full document (~300k tokens) stays the default for
 * the MCP; an agent reads the onboarding guide (the dashboard's sign-up flow,
 * step for step), the one-line index, a topic, or single operations.
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
/** Tokens a model reads, at ~4 characters per token. */
const tokens = (doc: unknown) => Math.round(JSON.stringify(doc).length / 4);
const slice = (sel: Parameters<typeof selectDocument>[1]) => {
  const out = selectDocument(full, sel);
  if (isSelectionError(out)) throw new Error(JSON.stringify(out));
  return out as Json;
};

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

describe("every read an agent is pointed to fits its budget (tokens)", () => {
  it("onboarding guide <= 8k tokens", () => expect(tokens(slice({ kind: "onboarding" }))).toBeLessThan(8_000));
  it("index <= 20k tokens", () => expect(tokens(slice({ kind: "index" }))).toBeLessThan(20_000));
  it("every topic page <= 22k tokens, in both customer and staff-key documents", () => {
    const over: string[] = [];
    for (const audience of ["public", "staff-key"] as const) {
      const doc = buildDocument({ audience });
      for (const [tag, pages] of tagPages(doc)) {
        pages.forEach((_, i) => {
          const n = tokens(selectDocument(doc, { kind: "tag", tag, page: i + 1 }));
          if (n > 22_000) over.push(`${audience} ${tag} p${i + 1}: ${n}`);
        });
      }
    }
    expect(over).toEqual([]);
  });
  it("one operation <= 5k tokens", () => expect(tokens(slice({ kind: "operations", ids: ["postV1Brands"] }))).toBeLessThan(5_000));
});

describe("the slices together cover the whole document, and only it", () => {
  it("topic pages hold every operation exactly once", () => {
    const fromPages = [...tagPages(full).values()].flat(2);
    expect([...fromPages].sort()).toEqual(operationKeys(full).sort());
  });

  it("the index lists every operationId", () => {
    const text = slice({ kind: "index" }).info.description as string;
    const missing = operationKeys(full)
      .map((k) => {
        const [m, p] = k.split(" ");
        return full.paths[p][m.toLowerCase()].operationId as string;
      })
      .filter((id) => !text.includes(`\`${id}\``));
    expect(missing).toEqual([]);
  });

  it("an operation slice resolves every $ref it carries", () => {
    const doc = slice({ kind: "operations", ids: ["postV1BrandsByIdOffersConfirm", "postV1SalesFunnelCampaigns"] });
    const broken: string[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const ref = (node as Json).$ref;
      if (typeof ref === "string") {
        const [, , section, name] = ref.split("/");
        if (!doc.components?.[section]?.[name]) broken.push(ref);
      }
      Object.values(node).forEach(visit);
    };
    visit(doc);
    expect(broken).toEqual([]);
    expect(operationKeys(doc).sort()).toEqual(["POST /v1/brands/{id}/offers/confirm", "POST /v1/sales-funnel-campaigns"]);
  });
});

describe("onboarding = the dashboard's sign-up flow", () => {
  it("names the dashboard's steps in the dashboard's order", () => {
    const titles = ONBOARDING_STEPS.map((s) => s.title);
    const order = ["We found your next clients", "Your company", "What you sell", "Who to write to", "Your signals", "What a client is worth", "Your offer, in six points", "What you give away", "Companies in your audience", "Pick your email style", "Your campaigns", "Prepay", "Start"];
    const at = order.map((t) => titles.findIndex((x) => x.startsWith(t)));
    expect(at.every((i) => i >= 0), JSON.stringify(order.filter((_, i) => at[i] < 0))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("every route of the flow is a customer operation that documents what it answers", () => {
    const keys = new Set(operationKeys(full));
    const missing = ONBOARDING_OPERATIONS.filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
    const empty = ONBOARDING_OPERATIONS.filter((key) => {
      const schemas = successSchemas(full, key);
      return schemas.length === 0 || schemas.every((s) => isEmptyBodySchema(full, s));
    });
    expect(empty).toEqual([]);
  });

  it("the guide names each route with its operationId, what to send and what it answers", () => {
    const text = slice({ kind: "onboarding" }).info.description as string;
    expect(text).toContain("`POST /v1/brands` (`postV1Brands`): send `url`, `name`; answers `brandId`");
    expect(text).toMatch(/`POST \/v1\/brands\/\{id\}\/offers\/confirm` \(`postV1BrandsByIdOffersConfirm`\): send `offers`\*, `chosenIndex`; answers `offers`, `chosenOfferId`/);
    expect(text).toContain('status: "ongoing"');
  });

  it("brand create and offer confirm document the ids they return (brand-service's served shape)", () => {
    expect(Object.keys(successSchemas(full, "POST /v1/brands")[0].properties)).toContain("brandId");
    const confirm = successSchemas(full, "POST /v1/brands/{id}/offers/confirm")[0];
    expect(Object.keys(confirm.properties.offers.items.properties)).toContain("offerId");
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
  it("points to the readable slices and the skills", () => {
    for (const s of ["?view=onboarding", "?view=index", "?tag=", "?operation=", "GET /v1/skills"]) expect(description).toContain(s);
  });
  it("never tells an agent that just signed up to create a key in the dashboard", () => {
    expect(description).not.toMatch(/1\. Create an API key in the/);
  });
});

describe("parseSelection", () => {
  it("reads each selection", () => {
    expect(parseSelection({})).toEqual({ kind: "full" });
    expect(parseSelection({ view: "index" })).toEqual({ kind: "index" });
    expect(parseSelection({ tag: "Brand", page: "2" })).toEqual({ kind: "tag", tag: "Brand", page: 2 });
    expect(parseSelection({ operation: "getV1Me, postV1Brands" })).toEqual({ kind: "operations", ids: ["getV1Me", "postV1Brands"] });
  });
  it("refuses unknown or mixed selections, never a silent fallback", () => {
    for (const q of [{ view: "short" }, { view: "index", tag: "Brand" }, { tag: "Brand", page: "0" }, { page: "2" }, { operation: "" }]) {
      expect(isSelectionError(parseSelection(q)), JSON.stringify(q)).toBe(true);
    }
    expect(isSelectionError(selectDocument(full, { kind: "tag", tag: "Nope", page: 1 }))).toBe(true);
    expect(isSelectionError(selectDocument(full, { kind: "operations", ids: ["nope"] }))).toBe(true);
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
          walk(layer.handle.stack, prefix + (m ? `/${m[1]}` : ""));
        }
      }
    };
    walk(mod.default._router.stack, "");
    expect(chains.size).toBeGreaterThan(400);
    const refused = operationKeys(full).filter((key) => chains.get(key)?.includes("authenticatePlatform"));
    expect(refused).toEqual([]);
  });
});

describe("GET /v1/me/openapi.json selections", () => {
  const app = express().use("/v1", meRouter);
  const auth = { Authorization: "Bearer distrib.usr_abcdefghijklmnopqrstuvwxyz0123456789" };

  it("?view=onboarding serves the guide, small", async () => {
    const res = await request(app).get("/v1/me/openapi.json?view=onboarding").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.info.description).toContain("## Open a first client, step by step");
    expect(res.text.length / 4).toBeLessThan(8_000);
    expect(res.headers.etag).toMatch(/^W\//);
  });

  it("?operation= serves those operations only", async () => {
    const res = await request(app).get("/v1/me/openapi.json?operation=postV1Brands").set(auth);
    expect(operationKeys(res.body)).toEqual(["POST /v1/brands"]);
  });

  it("no selection serves the full document", async () => {
    const res = await request(app).get("/v1/me/openapi.json").set(auth);
    expect(operationKeys(res.body).length).toBe(operationKeys(full).length);
  });

  it("an unknown selection is refused with the fix", async () => {
    const res = await request(app).get("/v1/me/openapi.json?tag=Nope").set(auth);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_tag");
    expect(res.body.tags).toContain("Brand");
  });
});
