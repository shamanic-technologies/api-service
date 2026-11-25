import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { z } from "zod";
import { invalidRequestBody } from "../../src/lib/invalid-request.js";

/**
 * AGENT-SIGNUP-UX-1125: a prospect's AI agent read only the top-level `error` of each 400 and got
 * `"Invalid request"`, so it guessed. Every gateway validation 400 now names the field(s) and what was
 * expected in `error`, adds `code` + `fields`, and keeps `details` (zod flatten) byte-identical.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "22222222-2222-4222-8222-222222222222";
    req.orgId = "11111111-1111-4111-8111-111111111111";
    req.authType = "user_key";
    next();
  },
  authenticatePlatform: (_req: any, _res: any, next: any) => next(),
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("@distribute/runs-client", () => ({ getRunsBatch: vi.fn().mockResolvedValue(new Map()) }));

import brandRouter from "../../src/routes/brand.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", brandRouter);
  return a;
}

describe("invalidRequestBody", () => {
  it("names every offending field and what was expected, on the error line", () => {
    const schema = z.object({ offers: z.array(z.string()), offerId: z.string().uuid() });
    const parsed = schema.safeParse({ offerId: "" });
    if (parsed.success) throw new Error("expected a refusal");
    const body = invalidRequestBody(parsed.error);
    expect(body.error).toMatch(/^Invalid request: /);
    expect(body.error).toContain("offers: ");
    expect(body.error).toContain("offerId: ");
    expect(body.code).toBe("invalid_request");
    expect(body.fields).toEqual(["offers", "offerId"]);
    expect(body.details).toEqual(parsed.error.flatten());
  });
});

describe("POST /v1/brands refusals name the field (onboarding step 2)", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as any;
  });

  it("a wrong type names the field", async () => {
    const res = await request(app()).post("/v1/brands").send({ url: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Invalid request: url: /);
    expect(res.body.code).toBe("invalid_request");
    expect(res.body.fields).toEqual(["url"]);
    expect(res.body.details.fieldErrors.url).toBeDefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("an empty body says url or name is required", async () => {
    const res = await request(app()).post("/v1/brands").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("url or name is required");
    expect(res.body.fields).toEqual(["url", "name"]);
    expect(res.body.details).toBe("Either url or name is required");
  });
});
