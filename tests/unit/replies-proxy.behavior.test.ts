import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { INSTANTLY_BASE } = vi.hoisted(() => {
  const INSTANTLY_BASE = "http://instantly.test.local";
  process.env.INSTANTLY_SERVICE_URL = INSTANTLY_BASE;
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
  return { INSTANTLY_BASE };
});

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user-1";
      req.orgId = "org-authenticated";
      req.runId = "run-1";
      req.authType = "user_key";
      next();
    },
  };
});

import repliesRouter from "../../src/routes/replies.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", repliesRouter);
  return a;
}

const BODY = { campaign_id: "camp-1", email: "jane@acme.com", body_html: "<p>Thursday works.</p>", sent_by: "human" };
let fetchMock: ReturnType<typeof vi.fn>;

describe("POST /v1/replies → instantly-service POST /orgs/replies", () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("forwards the body byte-identical with the authenticated org and user, and pipes the answer back", async () => {
    const upstream = JSON.stringify({ success: true, status: "sent", reply: { id: "r1" } });
    fetchMock.mockResolvedValue(new Response(upstream, { status: 200, headers: { "content-type": "application/json" } }));
    const res = await request(app()).post("/v1/replies").set("x-org-id", "org-forged").send(BODY);
    expect(res.status).toBe(200);
    expect(res.text).toBe(upstream);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${INSTANTLY_BASE}/orgs/replies`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org-authenticated");
    expect(headers["x-user-id"]).toBe("user-1");
    expect(JSON.parse(init.body as string)).toEqual(BODY);
  });

  it("forwards a refusal's status and body field-for-field", async () => {
    const refusal = { error: "A person already answered this thread", code: "human_took_over" };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(refusal), { status: 409, headers: { "content-type": "application/json" } }));
    const res = await request(app()).post("/v1/replies").send(BODY);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(refusal);
  });
});
