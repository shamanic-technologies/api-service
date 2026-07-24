import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Tests for the no-website-brand gateway passthrough routes:
 *   GET   /v1/brands/:id/business-context  -> brand-service GET  /orgs/brands/:id/business-context
 *   PUT   /v1/brands/:id/business-context  -> brand-service PUT  /orgs/brands/:id/business-context
 *   PATCH /v1/brands/:id                   -> brand-service PATCH /orgs/brands/:id
 * All pure passthrough: body forwarded verbatim, identity headers forwarded,
 * downstream owns the response shape and 4xx/409 errors propagate verbatim.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/v1", brandRouter);
  return app;
}

describe("GET /v1/brands/:id/business-context", () => {
  let app: express.Express;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const downstream = { content: "Acme is a B2B SaaS." };

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedUrl = undefined;
    capturedInit = undefined;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, json: () => Promise.resolve(downstream) };
    });
  });

  it("returns the downstream response verbatim", async () => {
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/business-context`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(downstream);
  });

  it("forwards a GET to brand-service /orgs/brands/:id/business-context with identity headers", async () => {
    await request(app).get(`/v1/brands/${BRAND_ID}/business-context`);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/business-context`);
    expect((capturedInit?.method ?? "GET")).toMatch(/GET/i);
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it("propagates an upstream 404 verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Brand not found"}'),
    }));
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/business-context`);
    expect(res.status).toBe(404);
  });
});

describe("PUT /v1/brands/:id/business-context", () => {
  let app: express.Express;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedUrl = undefined;
    capturedInit = undefined;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return { ok: true, status: 200, json: () => Promise.resolve({ content: body.content }) };
    });
  });

  it("returns the downstream response verbatim on success", async () => {
    const putBody = { content: "Acme is a B2B SaaS for retailers." };
    const res = await request(app).put(`/v1/brands/${BRAND_ID}/business-context`).send(putBody);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(putBody);
  });

  it("forwards the body byte-identical (PUT) to brand-service /orgs/brands/:id/business-context", async () => {
    const putBody = { content: "hello world" };
    await request(app).put(`/v1/brands/${BRAND_ID}/business-context`).send(putBody);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/business-context`);
    expect(capturedInit?.method).toBe("PUT");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(putBody);
  });

  it("forwards identity headers (x-org-id, x-user-id, x-run-id)", async () => {
    await request(app).put(`/v1/brands/${BRAND_ID}/business-context`).send({ content: "x" });
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it("forwards a large (~1MB) body intact", async () => {
    const bigContent = "a".repeat(1_000_000);
    const res = await request(app)
      .put(`/v1/brands/${BRAND_ID}/business-context`)
      .send({ content: bigContent });
    expect(res.status).toBe(200);
    expect(JSON.parse(capturedInit?.body as string).content).toHaveLength(1_000_000);
  });

  it("propagates an upstream 400 (validation) verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"Invalid request"}'),
    }));
    const res = await request(app).put(`/v1/brands/${BRAND_ID}/business-context`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid request");
  });
});

describe("PATCH /v1/brands/:id (attach website)", () => {
  let app: express.Express;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const downstream = { brandId: BRAND_ID, domain: "acme.com", name: "Acme", url: "https://acme.com" };

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedUrl = undefined;
    capturedInit = undefined;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, json: () => Promise.resolve(downstream) };
    });
  });

  it("returns the downstream response verbatim on success", async () => {
    const res = await request(app).patch(`/v1/brands/${BRAND_ID}`).send({ url: "https://acme.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(downstream);
  });

  it("forwards the body { url } byte-identical (PATCH) to brand-service /orgs/brands/:id", async () => {
    const patchBody = { url: "https://acme.com" };
    await request(app).patch(`/v1/brands/${BRAND_ID}`).send(patchBody);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}`);
    expect(capturedUrl).not.toContain("business-context");
    expect(capturedInit?.method).toBe("PATCH");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(patchBody);
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("propagates an upstream 409 (domain conflict) verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 409,
      text: () => Promise.resolve('{"error":"Domain already in use","code":"BRAND_DOMAIN_CONFLICT"}'),
    }));
    const res = await request(app).patch(`/v1/brands/${BRAND_ID}`).send({ url: "https://taken.com" });
    expect(res.status).toBe(409);
  });

  it("propagates an upstream 400 (invalid url) verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"Invalid request"}'),
    }));
    const res = await request(app).patch(`/v1/brands/${BRAND_ID}`).send({ url: "not-a-url" });
    expect(res.status).toBe(400);
  });
});
