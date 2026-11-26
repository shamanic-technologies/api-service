import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import express from "express";

/**
 * SOLO-PLAN-1125: the founder's pay link, public (the token is the auth). A REAL fake
 * billing-service answers on a socket so the assertions cover what goes over the wire:
 * redirects are not followed, the form body arrives as sent, every status is a page.
 * Nothing is mocked on the gateway side: no credentials at all must reach the page.
 */
const { state } = vi.hoisted(() => {
  const state = { port: 0 };
  return { state };
});

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
let seen: Seen[] = [];

const PAGE = "<!doctype html><html><body><h1>Start your 3-day trial</h1><form method=\"post\"><input type=\"hidden\" name=\"expect\" value=\"none\"></form></body></html>";
const EXPIRED = "<!doctype html><html><body><h1>This link has expired</h1></body></html>";

const fakeBilling = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url!.startsWith("/public/solo-plan/pay/bogus")) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(EXPIRED);
      return;
    }
    if (req.method === "POST") {
      res.writeHead(303, { location: "good.token?done=trial", "content-type": "text/plain; charset=utf-8" });
      res.end("See Other. Redirecting to good.token?done=trial");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
    res.end(PAGE);
  });
});

const stubFetch = globalThis.fetch;
beforeAll(async () => {
  // tests/setup.ts stubs global fetch; this file needs the real undici one on real sockets.
  const { fetch: undiciFetch } = await import("undici");
  globalThis.fetch = undiciFetch as unknown as typeof fetch;
  await new Promise<void>((r) => fakeBilling.listen(0, "127.0.0.1", r));
  state.port = (fakeBilling.address() as AddressInfo).port;
  process.env.BILLING_SERVICE_URL = `http://127.0.0.1:${state.port}`;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
});
afterAll(async () => {
  globalThis.fetch = stubFetch;
  await new Promise<void>((r) => fakeBilling.close(() => r()));
});
beforeEach(() => { seen = []; });

async function buildApp() {
  vi.resetModules();
  const { default: router } = await import("../../src/routes/solo-plan-pay-link.js");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

const URL = "/v1/billing/public/solo-plan/pay/good.token";

describe("solo plan pay link (public)", () => {
  it("GET returns billing's HTML untouched, with no auth and no identity forwarded", async () => {
    const res = await request(await buildApp()).get(URL);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.text).toBe(PAGE);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].url).toBe("/public/solo-plan/pay/good.token");
    expect(seen[0].headers["x-org-id"]).toBeUndefined();
    expect(seen[0].headers["x-user-id"]).toBeUndefined();
  });

  it("GET forwards the query (?done=) verbatim", async () => {
    await request(await buildApp()).get(`${URL}?done=trial`);
    expect(seen[0].url).toBe("/public/solo-plan/pay/good.token?done=trial");
  });

  it("POST forwards the form body as sent and returns billing's 303 + relative Location untouched", async () => {
    const res = await request(await buildApp())
      .post(URL)
      .set("content-type", "application/x-www-form-urlencoded")
      .send("expect=trialing%3A9900%3A2026-11-25T00%3A00%3A00.000Z")
      .redirects(0);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("good.token?done=trial");
    expect(seen).toHaveLength(1); // the redirect was NOT followed by the gateway
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe("/public/solo-plan/pay/good.token");
    expect(seen[0].headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(seen[0].body).toBe("expect=trialing%3A9900%3A2026-11-25T00%3A00%3A00.000Z");
  });

  it("a bogus token returns billing's 404 page, not a gateway error", async () => {
    const res = await request(await buildApp()).get("/v1/billing/public/solo-plan/pay/bogus");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.text).toBe(EXPIRED);

    const post = await request(await buildApp())
      .post("/v1/billing/public/solo-plan/pay/bogus")
      .type("form")
      .send("expect=none")
      .redirects(0);
    expect(post.status).toBe(404);
    expect(post.text).toBe(EXPIRED);
  });
});
