import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A downstream that never ANSWERS (container swapped by a deploy, DNS miss) used to
 * reach the caller as `500 {"error":"fetch failed"}`. Driven over REAL sockets: the
 * downstream URL points at a port nothing listens on, so undici raises the genuine
 * ECONNREFUSED it raises in prod. Pinned here:
 *   - a proxied GET answers 503 `upstream_unreachable` + Retry-After, after riding out
 *     the retry window;
 *   - a GET whose downstream comes back within the window succeeds;
 *   - a downstream's OWN structured 500 still passes through unchanged;
 *   - a route whose catch rebuilds its own `{ error }` envelope gets the named answer too.
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  const fake = (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  };
  return { ...actual, authenticate: fake, authenticatePlatform: fake };
});

import featuresRouter from "../../src/routes/features.js";
import promoCodesRouter from "../../src/routes/promo-codes.js";
import { externalServices } from "../../src/lib/service-client.js";
import { upstreamUnreachable } from "../../src/middleware/upstream-unreachable.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(upstreamUnreachable);
  app.use("/v1", featuresRouter);
  app.use("/v1", promoCodesRouter);
  return app;
}

const OFFER = "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e";
let closedPort: number;

async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function serve(port: number, status: number, body: unknown): Promise<http.Server> {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

const servers: http.Server[] = [];
const realFetch = globalThis.fetch;
beforeAll(async () => {
  // tests/setup.ts stubs global fetch; this file needs the real undici one on real sockets.
  const { fetch: undiciFetch } = await import("undici");
  globalThis.fetch = undiciFetch as unknown as typeof fetch;
  closedPort = await freePort();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("a downstream that refuses connections", () => {
  it("answers a proxied GET with 503 upstream_unreachable, a retry hint and no bare transport message", async () => {
    externalServices.features.url = `http://127.0.0.1:${closedPort}`;
    const started = Date.now();
    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/sales-funnels`);

    expect(Date.now() - started).toBeGreaterThanOrEqual(10_000); // rode out the swap window first
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.body).toMatchObject({
      code: "upstream_unreachable",
      service: "127.0.0.1",
      cause: "ECONNREFUSED",
      retryable: true,
      retryAfterSeconds: 5,
    });
    expect(res.body.error).toContain("temporarily unreachable");
    expect(res.body.error).toContain("retry in a few seconds");
    expect(res.body.error).not.toBe("fetch failed");
  }, 20_000);

  it("rides out a container swap: a GET whose downstream comes back within the window succeeds", async () => {
    const port = await freePort();
    externalServices.features.url = `http://127.0.0.1:${port}`;
    setTimeout(() => {
      void serve(port, 200, { rows: [] }).then((s) => servers.push(s));
    }, 2_000);

    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/sales-funnels`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rows: [] });
  }, 20_000);

  it("names the failure even on a route whose catch rebuilds its own { error } envelope", async () => {
    externalServices.billing.url = `http://127.0.0.1:${closedPort}`;
    const res = await request(buildApp()).get("/v1/promo-codes/welcome");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("upstream_unreachable");
    expect(res.headers["retry-after"]).toBe("5");
  }, 20_000);
});

describe("a downstream that answers with its own error", () => {
  it("passes a structured 500 through unchanged", async () => {
    const port = await freePort();
    const body = { error: "catalogue build failed", code: "CATALOGUE_BROKEN", details: { step: 3 } };
    servers.push(await serve(port, 500, body));
    externalServices.features.url = `http://127.0.0.1:${port}`;

    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/sales-funnels`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual(body);
    expect(res.headers["retry-after"]).toBeUndefined();
  });

  it("passes a plain 500 through unchanged on a route that rebuilds its own envelope", async () => {
    const port = await freePort();
    servers.push(await serve(port, 500, { error: "boom" }));
    externalServices.billing.url = `http://127.0.0.1:${port}`;

    const res = await request(buildApp()).get("/v1/promo-codes/welcome");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: JSON.stringify({ error: "boom" }) });
  });
});
