import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  buildDocument,
  HTTP_METHODS,
  PLATFORM_SECURITY_SCHEME,
  STAFF_ONLY_TAGS,
} from "../../src/openapi/document.js";
import { authenticatePlatform } from "../../src/middleware/auth.js";

/**
 * The published document describes the API a CUSTOMER can use — and nothing else.
 *
 * `https://api.distribute.you/openapi.json` is unauthenticated: it is what a
 * customer, an agent or a crawler reads to learn how to use this API. It used to
 * declare a second security scheme (`X-API-Key`, the shared platform secret) and
 * to describe the 24 operations behind it — fleet audit boards, credit grants,
 * per-org discounts, platform keys/prompts/chat config, cross-org brand listing,
 * platform uploads — plus 6 staff-only mailing-list operations documented under
 * `bearerAuth`. None of that is a customer's business.
 *
 * Documenting `X-API-Key` is also a TRAP: `authenticate()` branches on that
 * header BEFORE it reads `Authorization`, so a request carrying a valid Bearer
 * token and anything at all in `X-API-Key` is answered `401 Invalid admin key`
 * without the Bearer ever being examined.
 *
 * What this file pins:
 *  - the published document declares ONE scheme and no platform/staff operation;
 *  - the staff document still describes every one of them, so the CLI keeps its
 *    full command surface behind the platform key;
 *  - the ROUTES are untouched — removing an operation from the document is not
 *    removing it from the API;
 *  - the committed `openapi.json` is the published document, byte-for-byte.
 */

const PLATFORM_OPERATIONS = [
  "get /v1/features/audit/send-forecast",
  "get /v1/features/audit/accounts",
  "get /v1/features/audit/active-users",
  "get /v1/features/audit/active-users-by-user",
  "get /v1/features/audit/customer-success",
  "get /v1/features/audit/revenue",
  "post /platform-keys",
  "put /platform-prompts",
  "put /platform-chat/config",
  "get /v1/promo-codes/{code}",
  "patch /v1/promo-codes/{code}",
  "post /v1/billing/credits/grant",
  "get /v1/billing/credits/grants/all",
  "get /v1/billing/usage-discount",
  "put /v1/billing/usage-discount",
  "delete /v1/billing/usage-discount",
  "get /v1/instantly/audit/sending-forecast",
  "get /v1/instantly/audit/account-health",
  "get /v1/instantly/audit/account-detail",
  "get /v1/instantly/audit/capacity-history",
  "get /v1/instantly/audit/reconcile",
  "put /internal/emails/templates",
  "get /v1/admin/brands",
  "post /v1/platform-uploads",
  "get /v1/mailing-lists/{slug}/subscribers",
  "post /v1/mailing-lists/{slug}/subscribers",
  "delete /v1/mailing-lists/{slug}/subscribers",
  "post /v1/mailing-lists/updates/preview",
  "get /v1/mailing-lists/{slug}/updates",
  "post /v1/mailing-lists/{slug}/updates",
];

type Doc = {
  paths: Record<string, Record<string, { security?: unknown[]; tags?: string[] }>>;
  tags?: { name: string; description?: string }[];
  components?: { securitySchemes?: Record<string, unknown> };
};

function operationKeys(doc: Doc): string[] {
  const keys: string[] = [];
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) keys.push(`${method} ${path}`);
    }
  }
  return keys;
}

function schemesOf(operation: { security?: unknown[] }): string[] {
  return (operation.security ?? []).flatMap((requirement) =>
    Object.keys((requirement ?? {}) as Record<string, unknown>),
  );
}

const published = buildDocument() as Doc;
const staff = buildDocument({ audience: "staff" }) as Doc;

describe("published OpenAPI document", () => {
  it("declares exactly one security scheme", () => {
    expect(Object.keys(published.components?.securitySchemes ?? {})).toEqual([
      "bearerAuth",
    ]);
  });

  it("describes no operation that needs the platform key", () => {
    for (const [path, pathItem] of Object.entries(published.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation) continue;
        expect(
          schemesOf(operation),
          `${method.toUpperCase()} ${path} declares ${PLATFORM_SECURITY_SCHEME}`,
        ).not.toContain(PLATFORM_SECURITY_SCHEME);
      }
    }
  });

  it("describes no staff-only operation", () => {
    for (const [path, pathItem] of Object.entries(published.paths)) {
      for (const method of HTTP_METHODS) {
        const tags = pathItem[method]?.tags ?? [];
        for (const tag of tags) {
          expect(
            STAFF_ONLY_TAGS.has(tag),
            `${method.toUpperCase()} ${path} is tagged staff-only "${tag}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("drops every one of the known platform and staff operations", () => {
    const keys = new Set(operationKeys(published));
    for (const operation of PLATFORM_OPERATIONS) {
      expect(keys.has(operation), `${operation} is still published`).toBe(false);
    }
  });

  it("keeps the customer surface — nothing else was collateral", () => {
    const keys = new Set(operationKeys(published));
    for (const operation of [
      "get /openapi.json",
      "post /v1/api-keys",
      "get /v1/campaigns",
      "get /v1/leads",
      "get /v1/leads/stats",
      "get /v1/brands",
      "post /v1/keys",
      "get /v1/billing/accounts/balance",
      "get /v1/billing/credits/grants",
      "get /v1/platform/services",
    ]) {
      expect(keys.has(operation), `${operation} went missing`).toBe(true);
    }
    // The published document is the staff one minus exactly the operations above.
    expect(operationKeys(staff).length - operationKeys(published).length).toBe(
      PLATFORM_OPERATIONS.length + 1, // + GET /internal/openapi.json itself
    );
  });

  it("never mentions the platform key anywhere a reader could find it", () => {
    const serialized = JSON.stringify(published);
    expect(serialized).not.toContain("X-API-Key");
    expect(serialized).not.toContain("ADMIN_DISTRIBUTE_API_KEY");
    expect(serialized).not.toContain(PLATFORM_SECURITY_SCHEME);
    expect(serialized.toLowerCase()).not.toContain("staff-only");
  });

  it("carries no tag left without an operation", () => {
    const tagged = new Set(
      Object.values(published.paths).flatMap((pathItem) =>
        HTTP_METHODS.flatMap((method) => pathItem[method]?.tags ?? []),
      ),
    );
    for (const tag of published.tags ?? []) {
      expect(tagged.has(tag.name), `tag "${tag.name}" has no operation`).toBe(true);
    }
  });

  it("is what the committed openapi.json holds", () => {
    const committed = readFileSync(join(__dirname, "../../openapi.json"), "utf-8");
    expect(committed).toBe(JSON.stringify(published, null, 2));
  });
});

describe("staff OpenAPI document", () => {
  it("declares both security schemes", () => {
    expect(Object.keys(staff.components?.securitySchemes ?? {}).sort()).toEqual([
      PLATFORM_SECURITY_SCHEME,
      "bearerAuth",
    ]);
  });

  it("describes every platform and staff operation", () => {
    const keys = new Set(operationKeys(staff));
    for (const operation of PLATFORM_OPERATIONS) {
      expect(keys.has(operation), `${operation} missing from the staff document`).toBe(
        true,
      );
    }
  });

  it("is a superset of the published document", () => {
    const keys = new Set(operationKeys(staff));
    for (const operation of operationKeys(published)) {
      expect(keys.has(operation), `${operation} missing from the staff document`).toBe(
        true,
      );
    }
  });
});

describe("GET /internal/openapi.json", () => {
  /**
   * `src/index.ts` calls `app.listen()` at import time, so it cannot be driven
   * with supertest. The wiring assertion below pins the middleware + handler
   * pair that file uses; this app exercises the same REAL middleware and the
   * same REAL builder, so the gate itself is behavioural rather than a stub.
   */
  const app = express();
  app.get("/internal/openapi.json", authenticatePlatform, (_req, res) => {
    res.json(buildDocument({ audience: "staff" }));
  });

  it("401s without the platform key", async () => {
    const res = await request(app).get("/internal/openapi.json");
    expect(res.status).toBe(401);
  });

  it("401s on a wrong platform key", async () => {
    process.env.ADMIN_DISTRIBUTE_API_KEY = "the-real-platform-key";
    const res = await request(app)
      .get("/internal/openapi.json")
      .set("x-api-key", "guessed");
    expect(res.status).toBe(401);
  });

  it("serves the complete document to the platform key", async () => {
    process.env.ADMIN_DISTRIBUTE_API_KEY = "the-real-platform-key";
    const res = await request(app)
      .get("/internal/openapi.json")
      .set("x-api-key", "the-real-platform-key");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.components.securitySchemes).sort()).toEqual([
      PLATFORM_SECURITY_SCHEME,
      "bearerAuth",
    ]);
    expect(res.body.paths["/v1/billing/credits/grant"].post).toBeDefined();
  });

  it("is wired that way in index.ts", () => {
    const index = readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");
    expect(index).toContain(
      'app.get("/internal/openapi.json", authenticatePlatform,',
    );
    expect(index).toContain('buildDocument({ audience: "staff" })');
  });
});

describe("the operations themselves keep working", () => {
  const index = readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");

  it("still mounts every router whose operations left the document", () => {
    for (const mount of [
      'app.use("/platform-keys", platformKeysRoutes)',
      'app.use("/platform-prompts", platformPromptsRoutes)',
      'app.use("/platform-chat", platformChatRoutes)',
      'app.use("/internal", internalEmailsRoutes)',
      'app.use("/v1", creditsRoutes)',
      'app.use("/v1", usageDiscountRoutes)',
      'app.use("/v1", promoCodesRoutes)',
      'app.use("/v1", instantlyRoutes)',
      'app.use("/v1", mailingListsRoutes)',
      'app.use("/v1", platformUploadsRoutes)',
      'app.use("/v1", adminBrandsRoutes)',
      'app.use("/v1", featuresRoutes)',
    ]) {
      expect(index, `${mount} is gone — a route was removed, not just a doc entry`)
        .toContain(mount);
    }
  });
});

describe("staff-gated families stay accounted for", () => {
  /**
   * `apiKeyAuth` identifies a platform operation mechanically, but an operation
   * gated with `authenticate + requireStaff` declares `bearerAuth` like any
   * customer route — the document cannot tell them apart, so those families are
   * excluded by TAG via `STAFF_ONLY_TAGS`. If a new one appears, this fails
   * rather than letting it be published.
   */
  // Each entry must be excluded from the published document by one of the two
  // mechanisms, and the assertion below proves it is:
  //   mailing-lists.ts  → STAFF_ONLY_TAGS (its schemas declare `bearerAuth`)
  //   usage-discount.ts → its schemas declare `apiKeyAuth`, which is what the
  //   credits.ts          platform-keyed admin console actually sends on these
  //                       routes (`authenticate` accepts that key and sets
  //                       `authType: "admin"`, which is what `requireStaff` reads)
  const KNOWN_STAFF_BEARER_ROUTE_FILES = [
    "mailing-lists.ts",
    "usage-discount.ts",
    "credits.ts",
  ];

  it("finds no bearer + requireStaff route file outside the known list", () => {
    const routesDir = join(__dirname, "../../src/routes");
    const found: string[] = [];

    for (const file of readdirSync(routesDir).filter((f) => f.endsWith(".ts"))) {
      // Comments stripped first — a route file routinely EXPLAINS the other
      // tier, and a mention in prose is not a gate.
      const source = readFileSync(join(routesDir, file), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        // Import lists name middleware without chaining it.
        .replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, "");

      // Each `requireStaff` belongs to the middleware chain of one route, so it
      // is the NEAREST PRECEDING authenticator that decides its tier: a file can
      // hold both (credits.ts and usage-discount.ts do).
      const tokens = [...source.matchAll(/\b(authenticatePlatform|authenticate|requireStaff)\s*,/g)];
      let authenticator: string | null = null;
      for (const token of tokens) {
        if (token[1] === "requireStaff") {
          if (authenticator === "authenticate") {
            found.push(file);
            break;
          }
        } else {
          authenticator = token[1];
        }
      }
    }

    expect(found.sort()).toEqual([...KNOWN_STAFF_BEARER_ROUTE_FILES].sort());
  });

  it("excludes the tag the bearer-documented family is under", () => {
    expect(STAFF_ONLY_TAGS.has("Mailing Lists")).toBe(true);
  });

  it("publishes none of their operations", () => {
    const keys = new Set(operationKeys(published));
    for (const operation of PLATFORM_OPERATIONS.filter(
      (o) =>
        o.includes("/mailing-lists/") ||
        o.includes("/usage-discount") ||
        o.includes("/credits/grant"),
    )) {
      expect(keys.has(operation), `${operation} is still published`).toBe(false);
    }
  });
});
