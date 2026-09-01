import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { GATEWAY_BASE } = vi.hoisted(() => {
  const GATEWAY_BASE = "http://email-gateway.test.local";
  process.env.EMAIL_GATEWAY_SERVICE_URL = GATEWAY_BASE;
  process.env.EMAIL_GATEWAY_SERVICE_API_KEY = "email-gateway-test-key";
  return { GATEWAY_BASE };
});

/**
 * /v1/emails/opt-outs — the three routes a triage board needs to move a card into
 * Opt-out for somebody who asked by SMS, by phone, or in person.
 *
 * A source-substring test cannot see what goes over the wire, and what matters here is
 * exactly that: the forwarded downstream path, the org resolved from the authenticated
 * identity (never one the caller names), the body and query forwarded untouched, and an
 * upstream refusal reaching the caller with its own status AND its `code` intact — the
 * board branches on that code to say why a move did not take.
 *
 * Per CLAUDE.md #6/#8 the payloads below are fixtures, not a contract this repo owns.
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import emailsRouter from "../../src/routes/emails.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", emailsRouter);
  return app;
}

const RECORD = {
  id: "0f2a5f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
  orgId: "org_test456",
  email: "prospect@example.com",
  channel: "sms",
  statedBy: "user_test123",
  notes: "Texted me to stop",
  statedAt: "2026-09-01T08:00:00.000Z",
  withdrawnAt: null,
  withdrawnBy: null,
};

describe("/v1/emails/opt-outs — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            idempotent: false,
            campaignsAffected: 2,
            campaignsStopped: 2,
            optOut: RECORD,
          }),
      };
    });
  });

  it("records an opt-out on email-gateway's real path, carrying the resolved identity", async () => {
    const body = { email: "prospect@example.com", channel: "sms", notes: "Texted me to stop" };
    const res = await request(buildApp()).post("/v1/emails/opt-outs").send(body);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GATEWAY_BASE}/orgs/opt-outs`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("email-gateway-test-key");
    expect(res.body.optOut).toEqual(RECORD);
  });

  it("forwards a channel this gateway has never heard of, rather than refusing it", async () => {
    // instantly-service owns the vocabulary; a stale local enum here would 400 a value
    // its owner accepts. Nothing is parsed, so an unknown channel simply travels.
    const body = { email: "prospect@example.com", channel: "carrier-pigeon" };
    const res = await request(buildApp()).post("/v1/emails/opt-outs").send(body);

    expect(res.status).toBe(200);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("keeps every field of the body, including ones documented nowhere here", async () => {
    const body = {
      email: "prospect@example.com",
      channel: "call",
      notes: "asked on the phone",
      statedAt: "2026-08-31T17:20:00.000Z",
      somethingUpstreamShipsNext: { nested: true },
    };
    await request(buildApp()).post("/v1/emails/opt-outs").send(body);

    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("ignores a caller-supplied org — only the authenticated org reaches the gateway", async () => {
    await request(buildApp())
      .post("/v1/emails/opt-outs")
      .set("x-org-id", "someone-elses-org")
      .send({ email: "prospect@example.com", channel: "sms" });

    expect(calls[0].url).toBe(`${GATEWAY_BASE}/orgs/opt-outs`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("lists the log, forwarding the caller's query string verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve({ optOuts: [RECORD] }) };
    });

    const res = await request(buildApp()).get(
      "/v1/emails/opt-outs?standing_only=true&email=prospect%40example.com&limit=50&filterWeDoNotKnow=x",
    );

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(
      `${GATEWAY_BASE}/orgs/opt-outs?standing_only=true&email=prospect%40example.com&limit=50&filterWeDoNotKnow=x`,
    );
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(res.body).toEqual({ optOuts: [RECORD] });
  });

  it("lists with no query string when the caller sent none", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve({ optOuts: [] }) };
    });

    await request(buildApp()).get("/v1/emails/opt-outs");

    expect(calls[0].url).toBe(`${GATEWAY_BASE}/orgs/opt-outs`);
  });

  it("withdraws on the withdrawals path, not on the record path", async () => {
    const withdrawn = { ...RECORD, withdrawnAt: "2026-09-01T09:00:00.000Z", withdrawnBy: "user_test123" };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ campaignsAffected: 2, optOut: withdrawn }),
      };
    });

    const res = await request(buildApp())
      .post("/v1/emails/opt-outs/withdrawals")
      .send({ email: "prospect@example.com", notes: "came back" });

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${GATEWAY_BASE}/orgs/opt-outs/withdrawals`);
    expect(JSON.parse(calls[0].options.body)).toEqual({
      email: "prospect@example.com",
      notes: "came back",
    });
    expect(res.body.optOut).toEqual(withdrawn);
  });

  it("hands a refusal to the caller with its status and its code intact", async () => {
    // Flattening the upstream body into { error: "<the whole JSON>" } would destroy the
    // code the board branches on to say why the card did not move (CLAUDE.md #7).
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 404,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: "No standing opt-out for this person", code: "no_standing_opt_out" }),
          ),
        json: () => Promise.resolve({}),
      };
    });

    const res = await request(buildApp())
      .post("/v1/emails/opt-outs/withdrawals")
      .send({ email: "prospect@example.com" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: "No standing opt-out for this person",
      code: "no_standing_opt_out",
    });
  });

  it("hands a rejected channel back as upstream's own 400, not as a local one", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(JSON.stringify({ error: "Unknown channel", code: "invalid_channel" })),
        json: () => Promise.resolve({}),
      };
    });

    const res = await request(buildApp())
      .post("/v1/emails/opt-outs")
      .send({ email: "prospect@example.com", channel: "carrier-pigeon" });

    // The request reached the owner of the vocabulary — this hop refused nothing.
    expect(calls).toHaveLength(1);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown channel", code: "invalid_channel" });
  });
});
