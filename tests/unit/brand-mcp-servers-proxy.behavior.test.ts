import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

const { CHAT_BASE, USER_KEY } = vi.hoisted(() => {
  const CHAT_BASE = "http://chat.test.local";
  process.env.CHAT_SERVICE_URL = CHAT_BASE;
  process.env.CHAT_SERVICE_API_KEY = "chat-test-key";
  process.env.CRM_SERVICE_URL = "http://crm.test.local";
  process.env.CRM_SERVICE_API_KEY = "crm-test-key";
  return { CHAT_BASE, USER_KEY: "distrib.usr_abcdefghijklmnopqrstuvwxyz0123456789" };
});

/**
 * BRAND-MCP-1109: /v1/brands/:brandId/mcp-servers/* → chat-service
 * /orgs/brands/:brandId/mcp-servers/*, same suffix. Driven through the real router
 * with a stubbed fetch: full downstream URL, method, authenticated identity headers
 * (+ x-brand-id from the path), body and query verbatim, upstream status + body
 * verbatim. And the plug body's `authorization` secret never reaches the customer
 * call log nor the gateway's console.
 */
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_authenticated";
    req.orgId = "org_authenticated";
    req.runId = "run_1";
    if (req.headers.authorization) {
      req.authType = "user_key";
      req.userKeyScope = { isStaff: false, memberships: [], email: "client@acme.com", displayName: "Ada Client" };
    } else {
      req.authType = "admin";
    }
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import brandMcpRouter from "../../src/routes/brand-mcp-servers.js";
import { _queuedCalls, _resetCallLog, recordCustomerCalls } from "../../src/lib/call-log.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(recordCustomerCalls);
  app.use("/v1", brandMcpRouter);
  app.use((_req, res) => res.status(404).json({ error: "gateway route not found" }));
  return app;
}

const BRAND = "f4d73dab-1f9d-49b2-b16e-63ecde76a5eb";
const SERVER = "11111111-1111-4111-8111-111111111111";
const SECRET = "Token plain-brand-secret-value-42";
const RAW = { server: { id: SERVER, status: "a-status-this-gateway-never-heard-of", hasAuthorization: true }, extra: 7 };

let calls: Array<{ url: string; init: any }>;
function upstream(status: number, body: unknown) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  _resetCallLog();
  upstream(200, RAW);
});
afterEach(() => {
  _resetCallLog();
  vi.restoreAllMocks();
});

const CASES: Array<{ name: string; method: "get" | "post" | "delete"; path: string; downstream: string; body?: unknown }> = [
  { name: "list", method: "get", path: `/v1/brands/${BRAND}/mcp-servers`, downstream: `/orgs/brands/${BRAND}/mcp-servers` },
  {
    name: "plug",
    method: "post",
    path: `/v1/brands/${BRAND}/mcp-servers`,
    downstream: `/orgs/brands/${BRAND}/mcp-servers`,
    body: { name: "Acme CRM", url: "https://mcp.acme.com/mcp", authorization: SECRET, aFieldChatServiceMayAddLater: 1 },
  },
  {
    name: "re-check",
    method: "post",
    path: `/v1/brands/${BRAND}/mcp-servers/${SERVER}/check`,
    downstream: `/orgs/brands/${BRAND}/mcp-servers/${SERVER}/check`,
  },
  {
    name: "unplug",
    method: "delete",
    path: `/v1/brands/${BRAND}/mcp-servers/${SERVER}`,
    downstream: `/orgs/brands/${BRAND}/mcp-servers/${SERVER}`,
  },
];

describe.each(CASES)("$name", ({ method, path, downstream, body }) => {
  it("reaches the exact chat-service path with the authenticated org, user, run and the path's brand, body verbatim", async () => {
    let r = request(buildApp())[method](path).set("x-org-id", "org_spoofed_by_caller").set("x-brand-id", "brand_spoofed");
    if (body !== undefined) r = r.send(body as object);
    const res = await r;
    expect(res.status).toBe(200);
    expect(res.body).toEqual(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CHAT_BASE}${downstream}`);
    expect(calls[0].init.method).toBe(method.toUpperCase());
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_authenticated");
    expect(headers["x-run-id"]).toBe("run_1");
    expect(headers["x-brand-id"]).toBe(BRAND);
    if (body !== undefined) expect(JSON.parse(calls[0].init.body)).toEqual(body);
    if (method !== "post") expect(calls[0].init.body).toBeUndefined();
  });

  it("forwards chat-service's refusal with its own status and body", async () => {
    upstream(404, { error: "No such server for this brand", code: "x" });
    let r = request(buildApp())[method](path);
    if (body !== undefined) r = r.send(body as object);
    const res = await r;
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No such server for this brand", code: "x" });
  });
});

describe("status codes and query", () => {
  it("a plug keeps chat-service's 201", async () => {
    upstream(201, RAW);
    const res = await request(buildApp()).post(`/v1/brands/${BRAND}/mcp-servers`).send({ name: "a", url: "https://a.com/mcp" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(RAW);
  });

  it("a 409 (URL already plugged) keeps its status and body", async () => {
    upstream(409, { error: "This URL is already plugged for the brand" });
    const res = await request(buildApp()).post(`/v1/brands/${BRAND}/mcp-servers`).send({ name: "a", url: "https://a.com/mcp" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This URL is already plugged for the brand" });
  });

  it("the query string is forwarded verbatim", async () => {
    await request(buildApp()).get(`/v1/brands/${BRAND}/mcp-servers?x=1&x=2`);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/brands/${BRAND}/mcp-servers?x=1&x=2`);
  });

  it("a path smuggled in a param stays one encoded segment (never an /internal path)", async () => {
    await request(buildApp()).get(`/v1/brands/..%2F..%2Finternal%2Fx/mcp-servers`);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/brands/..%2F..%2Finternal%2Fx/mcp-servers`);
  });
});

describe("the plug's Authorization value is never logged", () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("the customer call log stores the plug with `authorization` redacted", async () => {
    upstream(201, RAW);
    await request(buildApp())
      .post(`/v1/brands/${BRAND}/mcp-servers`)
      .set("Authorization", `Bearer ${USER_KEY}`)
      .send({ name: "Acme CRM", url: "https://mcp.acme.com/mcp", authorization: SECRET });
    // The secret still reached chat-service, which stores it in key-service.
    expect(JSON.parse(calls[0].init.body).authorization).toBe(SECRET);
    await settle();
    const recs = _queuedCalls();
    expect(recs).toHaveLength(1);
    expect(recs[0].path).toBe(`/v1/brands/${BRAND}/mcp-servers`);
    const stored = JSON.stringify(recs);
    expect(stored).not.toContain("plain-brand-secret-value-42");
    expect(JSON.parse(recs[0].requestBody!)).toEqual({ name: "Acme CRM", url: "https://mcp.acme.com/mcp", authorization: "[redacted]" });
  });

  it("a refused plug logs no request body on the gateway console", async () => {
    upstream(400, { error: "url must be public https" });
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    const res = await request(buildApp())
      .post(`/v1/brands/${BRAND}/mcp-servers`)
      .send({ name: "a", url: "http://10.0.0.1/mcp", authorization: SECRET });
    expect(res.status).toBe(400);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain("plain-brand-secret-value-42");
  });
});
