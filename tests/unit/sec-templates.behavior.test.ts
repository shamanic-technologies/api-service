import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * SEC-TEMPLATES-1120. On 2026-11-20 an API-signup org called PUT /v1/emails/templates with its
 * user key and wrote "phish…" templates into transactional-email-service's GLOBAL store (no org
 * column, name unique: last writer wins), then POST /v1/emails/send 12 times. These tests pin
 * that no customer (user key, or a signed-in customer through the dashboard's browser proxy)
 * reaches the template store or sends one of our templates, while our own servers still do.
 *
 * `authenticatePlatform`, `refuseForwardedIdentity` and `requirePlatformSender` are REAL here.
 * Only `authenticate` is stubbed (it resolves keys over the network): it sets `authType` from
 * the Authorization header the way the real one does (Bearer → user_key, else platform key).
 */
vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/middleware/auth.js")>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.authType = req.headers.authorization ? "user_key" : "admin";
      req.orgId = "3afacd9a-fe2f-4413-b51f-217f30920830";
      req.userId = "user_attacker";
      next();
    },
  };
});

import emailsRoutes from "../../src/routes/emails.js";
import internalEmailsRoutes from "../../src/routes/internal-emails.js";
import { staffEmailAllowlist } from "../../src/lib/staff.js";

const PLATFORM_KEY = "sec-templates-platform-key";
const PHISH = {
  templates: [
    {
      name: "welcome",
      subject: "Urgent: verify {{firstName}}",
      htmlBody: '<a href="http://evil.example/x">verify</a>',
      from: "Distribute <hello@distribute.you>",
    },
  ],
};
const SEND = { eventType: "phish25880a", recipientEmail: "victim@example.com", metadata: { firstName: "A" } };

let calls: string[] = [];

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", emailsRoutes);
  a.use("/internal", internalEmailsRoutes);
  return a;
}

beforeEach(() => {
  calls = [];
  process.env.ADMIN_DISTRIBUTE_API_KEY = PLATFORM_KEY;
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    calls.push(new URL(url).pathname);
    return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
  }) as any;
});

describe("template store writes are server-to-server only", () => {
  for (const path of ["/v1/emails/templates", "/internal/emails/templates"]) {
    it(`${path}: a customer user key is refused, nothing written`, async () => {
      const res = await request(app()).put(path).set("Authorization", "Bearer distrib.usr_attacker").send(PHISH);
      expect(res.status).toBe(401);
      expect(calls).toEqual([]);
    });

    it(`${path}: a signed-in customer through the dashboard browser proxy is refused, nothing written`, async () => {
      const res = await request(app())
        .put(path)
        .set("X-API-Key", PLATFORM_KEY)
        .set("x-external-org-id", "org_customer")
        .set("x-external-user-id", "user_customer")
        .set("x-email", "attacker@euploading.com")
        .send(PHISH);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("server_to_server_only");
      expect(calls).toEqual([]);
    });

    it(`${path}: our own server (platform key, no identity) still registers`, async () => {
      const res = await request(app()).put(path).set("X-API-Key", PLATFORM_KEY).send(PHISH);
      expect(res.status).toBe(200);
      expect(calls).toEqual(["/platform-templates"]);
    });
  }
});

describe("POST /v1/emails/send admits platform senders only", () => {
  it("a customer user key is refused 403 platform_only, nothing sent", async () => {
    const res = await request(app()).post("/v1/emails/send").set("Authorization", "Bearer distrib.usr_attacker").send(SEND);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("platform_only");
    expect(calls).toEqual([]);
  });

  it("a signed-in customer through the browser proxy (non-staff x-email) is refused, nothing sent", async () => {
    const res = await request(app())
      .post("/v1/emails/send")
      .set("X-API-Key", PLATFORM_KEY)
      .set("x-email", "attacker@euploading.com")
      .send(SEND);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("browser_session_refused");
    expect(calls).toEqual([]);
  });

  it("our dashboard servers (platform key, no x-email) still send", async () => {
    const res = await request(app()).post("/v1/emails/send").send({ eventType: "team_member_joined", recipientEmail: "admin@client.com" });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["/send"]);
  });

  it("the staff admin app (platform key + staff x-email) still sends", async () => {
    const staff = [...staffEmailAllowlist()][0];
    const res = await request(app()).post("/v1/emails/send").set("x-email", staff).send({ eventType: "campaign_created" });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["/send"]);
  });
});
