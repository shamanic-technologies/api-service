import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { requireStaff, type AuthenticatedRequest } from "../../src/middleware/auth.js";

const creditsRoutePath = path.join(__dirname, "../../src/routes/credits.ts");
const content = fs.readFileSync(creditsRoutePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const authPath = path.join(__dirname, "../../src/middleware/auth.ts");
const authContent = fs.readFileSync(authPath, "utf-8");

describe("Credit-grant proxy routes (source)", () => {
  it("should have POST /billing/credits/grant route", () => {
    expect(content).toContain('"/billing/credits/grant"');
    expect(content).toContain("router.post");
  });

  it("should have GET /billing/credits/grants route", () => {
    expect(content).toContain('"/billing/credits/grants"');
  });

  it("should have GET /billing/credits/grants/all route", () => {
    expect(content).toContain('"/billing/credits/grants/all"');
  });

  it("should gate the staff grant mutation with authenticate + requireOrg + requireStaff", () => {
    // Only POST /billing/credits/grant uses the staff org-resolving chain now.
    const matches = content.match(/authenticate,\s*requireOrg,\s*requireStaff/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("should gate the per-org grants ledger with normal org auth (NO requireStaff)", () => {
    // GET /billing/credits/grants is now readable by any org for its OWN grants
    // (customer dashboard "Gifts received"). It must use authenticate + requireOrg WITHOUT
    // requireStaff — same tier as GET /billing/accounts.
    // Slice just the middleware list of the per-org route: from its mount string up to the
    // start of its async handler (so the grants/all comment that follows is excluded).
    const mountIdx = content.indexOf('"/billing/credits/grants"');
    const middlewares = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(middlewares).toContain("authenticate,");
    expect(middlewares).toContain("requireOrg,");
    expect(middlewares).not.toContain("requireStaff");
  });

  it("should gate the cross-org ledger with authenticatePlatform + requireStaff (no org)", () => {
    expect(content).toContain("authenticatePlatform,");
    const matches = content.match(/authenticatePlatform,\s*requireStaff/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("staff gate (requireStaff) remains on exactly the mutating grant + cross-org ledger", () => {
    // Match `requireStaff,` (import + middleware usages) — prose comments mentioning the
    // word lack the trailing comma, so this counts code references only.
    const matches = content.match(/requireStaff,/g);
    // 1 import + 2 route usages (POST grant, GET grants/all). The per-org GET grants dropped it.
    expect(matches!.length).toBe(3);
  });

  it("should forward correct LOCKED downstream billing paths", () => {
    expect(content).toContain('"/v1/credits/grant"');
    expect(content).toContain('"/v1/credits/grants"');
    expect(content).toContain('"/internal/credits/grants"');
  });

  it("should proxy to externalServices.billing", () => {
    expect(content).toContain("externalServices.billing");
  });

  it("should forward body as-is on grant (no transform)", () => {
    expect(content).toContain("body: req.body");
  });

  it("should forward the verified staff x-email downstream", () => {
    expect(content).toContain('headers["x-email"] = req.staffEmail');
  });
});

describe("Credit-grant OpenAPI schemas", () => {
  it("should register all three credit-grant paths", () => {
    expect(schemaContent).toContain('path: "/v1/billing/credits/grant"');
    expect(schemaContent).toContain('path: "/v1/billing/credits/grants"');
    expect(schemaContent).toContain('path: "/v1/billing/credits/grants/all"');
  });

  it("response schemas are passthrough (transparent proxy contract)", () => {
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("CreditGrantResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("CreditGrantsResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("PlatformCreditGrantsResponse")');
  });

  it("should declare CreditGrantRequest with amountCents + idempotencyKey", () => {
    expect(schemaContent).toContain("CreditGrantRequest");
    expect(schemaContent).toContain("amountCents");
    expect(schemaContent).toContain("idempotencyKey");
  });

  it("should gate the credit routes with platformAuth security", () => {
    // 403 "Not staff" response declared on the credit routes
    expect(schemaContent).toContain('403: { description: "Not staff"');
  });
});

describe("Credit routes mounted in index.ts", () => {
  it("should import and mount creditsRoutes", () => {
    expect(indexContent).toContain("creditsRoutes");
    expect(indexContent).toContain("./routes/credits");
  });
});

describe("requireStaff middleware is defined in auth.ts", () => {
  it("should export requireStaff and read STAFF_EMAILS", () => {
    expect(authContent).toContain("export function requireStaff");
    expect(authContent).toContain("STAFF_EMAILS");
  });
});

// ---------------------------------------------------------------------------
// Runtime behavior of the requireStaff gate — the security contract.
// ---------------------------------------------------------------------------
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  return res;
}

function runGate(reqOverrides: Partial<AuthenticatedRequest> & { headers?: Record<string, string> }) {
  const req = {
    authType: "admin",
    headers: {},
    path: "/billing/credits/grant",
    ...reqOverrides,
  } as unknown as AuthenticatedRequest;
  const res = mockRes();
  const next = vi.fn();
  requireStaff(req, res, next as any);
  return { req, res, next };
}

describe("requireStaff runtime gate", () => {
  const ORIGINAL = process.env.STAFF_EMAILS;
  beforeEach(() => {
    process.env.STAFF_EMAILS = "staff@distribute.you, Boss@Distribute.You";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.STAFF_EMAILS;
    else process.env.STAFF_EMAILS = ORIGINAL;
  });

  it("passes a staff x-email (admin auth)", () => {
    const { res, next, req } = runGate({ authType: "admin", headers: { "x-email": "staff@distribute.you" } });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect((req as any).staffEmail).toBe("staff@distribute.you");
  });

  it("is case/space-insensitive on the email match", () => {
    const { next } = runGate({ authType: "admin", headers: { "x-email": "  BOSS@distribute.you " } });
    expect(next).toHaveBeenCalledOnce();
  });

  it("403s a non-staff x-email", () => {
    const { res, next } = runGate({ authType: "admin", headers: { "x-email": "customer@acme.com" } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("403s an absent x-email", () => {
    const { res, next } = runGate({ authType: "admin", headers: {} });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("403s a Bearer user-key even with a forged staff x-email (closes self-grant hole)", () => {
    const { res, next } = runGate({ authType: "user_key", headers: { "x-email": "staff@distribute.you" } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("403s everyone when STAFF_EMAILS is empty (fail closed)", () => {
    process.env.STAFF_EMAILS = "";
    const { res, next } = runGate({ authType: "admin", headers: { "x-email": "staff@distribute.you" } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
