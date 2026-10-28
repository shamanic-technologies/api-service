import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { FEATURES_BASE };
});

/**
 * THREADS-CAMPAIGN-1028: the catalogue declarations a staff member makes through the MCP (a channel, its
 * publication, a leg on it, a step), relayed to features-service. Real `requireStaffActor`; only
 * `authenticateUser` is stubbed. The author the producer records is the authenticated staff email, never
 * the body's; refusals come back verbatim.
 */
const identity = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  return {
    ...actual,
    authenticateUser: (req: any, _res: any, next: any) => {
      Object.assign(req, { userId: "user-1", runId: "run-1" }, identity.current);
      next();
    },
  };
});

import router from "../../src/routes/catalogue-staff.js";
import { STAFF_KEY_OPERATIONS } from "../../src/openapi/document.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(router);
  return a;
}

const STAFF_KEY = { authType: "user_key", userKeyScope: { isStaff: true, email: "Kevin@Distribute.you", memberships: [] } };
const CLIENT_KEY = { authType: "user_key", userKeyScope: { isStaff: false, email: "client@acme.com", memberships: [] }, orgId: "org-client" };

let calls: Array<{ url: string; init: any }>;
function upstream(status: number, raw: string) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(raw, { status, headers: { "content-type": "application/json" } });
  });
}

const CHANNEL = {
  slug: "threads-post",
  name: "Threads posts",
  description: "The brand publishes threads on its connected Threads accounts.",
  shortDescription: "Threads on your Threads accounts",
  icon: "at",
  channelType: "earned",
  operatedBy: "platform",
  performedBy: "software",
};
const LEG = { fromStep: null, toStep: "post_published", mode: "proactive" };
const STEP = { key: "thread_published", label: "Thread published", description: "d", shortDescription: "s", icon: "at", subjectKind: "object" };

type Case = { method: "post" | "get" | "patch"; path: string; downstream: string; body?: Record<string, unknown>; author: "createdBy" | "updatedBy" | null; status: number };
const CASES: Case[] = [
  { method: "post", path: "/v1/declarations/channels", downstream: "/internal/declarations/channels", body: CHANNEL, author: "createdBy", status: 201 },
  { method: "get", path: "/v1/declarations/channels/threads-post", downstream: "/internal/declarations/channels/threads-post", author: null, status: 200 },
  { method: "patch", path: "/v1/declarations/channels/threads-post", downstream: "/internal/declarations/channels/threads-post", body: { published: true }, author: "updatedBy", status: 200 },
  { method: "post", path: "/v1/declarations/channels/threads-post/legs", downstream: "/internal/declarations/channels/threads-post/legs", body: LEG, author: "createdBy", status: 201 },
  {
    method: "patch",
    path: "/v1/declarations/channels/threads-post/legs/start_to_post_published",
    downstream: "/internal/declarations/channels/threads-post/legs/start_to_post_published",
    body: { published: true },
    author: "updatedBy",
    status: 200,
  },
  { method: "post", path: "/v1/catalogue/steps", downstream: "/internal/catalogue/steps", body: STEP, author: "createdBy", status: 201 },
];

beforeEach(() => upstream(201, "{}"));

describe.each(CASES)("$method $path", (c) => {
  const RAW = '{"slug":"threads-post","someNewField":true}';

  it("a STAFF key: exact downstream path + method, body verbatim with the author = the staff email, status + bytes back", async () => {
    identity.current = STAFF_KEY;
    upstream(c.status, RAW);
    let r = request(app())[c.method](c.path).set("authorization", "Bearer distrib.usr_x");
    if (c.body) r = r.send({ ...c.body, createdBy: "evil@x.com", updatedBy: "evil@x.com" });
    const res = await r;
    expect(res.status).toBe(c.status);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}${c.downstream}`);
    expect(calls[0].init.method).toBe(c.method.toUpperCase());
    expect(calls[0].init.headers["X-API-Key"]).toBe("features-test-key");
    if (c.author) {
      const sent = JSON.parse(calls[0].init.body);
      expect(sent[c.author]).toBe("kevin@distribute.you");
      for (const [k, v] of Object.entries(c.body!)) expect(sent[k]).toEqual(v);
    } else {
      expect(calls[0].init.body).toBeUndefined();
    }
  });

  it("a CLIENT key is refused 403 staff_only; features-service never called", async () => {
    identity.current = CLIENT_KEY;
    let r = request(app())[c.method](c.path).set("x-email", "kevin@distribute.you");
    if (c.body) r = r.send(c.body);
    const res = await r;
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(calls).toHaveLength(0);
  });

  it("a features-service 4xx is relayed with its code verbatim", async () => {
    identity.current = STAFF_KEY;
    const refusal = '{"error":"a feature or channel threads-post already exists","reason":"channel_exists"}';
    upstream(409, refusal);
    let r = request(app())[c.method](c.path);
    if (c.body) r = r.send(c.body);
    const res = await r;
    expect(res.status).toBe(409);
    expect(res.text).toBe(refusal);
  });

  it("is listed in STAFF_KEY_OPERATIONS (the staff key's document carries it, the public one does not)", () => {
    const templated = c.path
      .replace("/legs/start_to_post_published", "/legs/{legKey}")
      .replace("/channels/threads-post", "/channels/{slug}");
    expect(STAFF_KEY_OPERATIONS.has(`${c.method.toUpperCase()} ${templated}`)).toBe(true);
  });
});

describe("path params are re-encoded on the way down", () => {
  it("a slug carrying a reserved character is URL-encoded", async () => {
    identity.current = STAFF_KEY;
    upstream(404, '{"error":"no channel a b","reason":"channel_not_found"}');
    const res = await request(app()).get("/v1/declarations/channels/a%20b");
    expect(res.status).toBe(404);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/declarations/channels/a%20b`);
  });
});
