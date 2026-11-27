import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";

/**
 * SECURITY-ALERTS-1128. The 2026-11-20 intrusion (keys minted as `pentest-probe`, 112
 * code-bearing workflows, `/v1/brands/%2e%2e%2f...` probes, 740 tables read through
 * `/internal/admin/*`) alerted nobody for 7 days. These tests drive the REAL security watch,
 * path guard, `authenticatePlatform` + `requireStaffHuman` and `requireStaffActor`, and pin:
 * each trigger raises exactly one `security_alert` per incident, staff never alert on their own
 * acts, and every admin call / key mint / detection leaves an audit row.
 */

import {
  securityWatch,
  markCodeBearing,
  setAlertSender,
  resetSecurityWatch,
  observe,
  routeTemplate,
  isTrustedSourceIp,
  PROBE_DISTINCT_4XX,
  KEY_MINT_BURST,
  PLATFORM_KEY_GUESSES,
  type SecurityAlert,
} from "../../src/lib/security-watch.js";
import { setAuditWriter, type AuditRow } from "../../src/lib/security-audit-store.js";
import { refuseTraversalPaths } from "../../src/middleware/path-guard.js";
import { requireStaffActor } from "../../src/middleware/auth.js";
import adminRoutes from "../../src/routes/admin.js";

const PLATFORM_KEY = "security-alerts-platform-key";
const STAFF_HUMAN = { "x-email": "kevin@distribute.you", "x-external-user-id": "user_2yaCEpxeoOEIfXTdxTMY8pM8jXW" };
const EDGE = (ip: string) => ({ "cf-connecting-ip": ip });

let alerts: SecurityAlert[] = [];
let rows: AuditRow[] = [];

/** Stand-in for `authenticate`: sets what it would set, from test headers. */
function fakeAuth(req: any, _res: any, next: any) {
  const kind = req.headers["x-test-auth"];
  if (kind === "user_key" || kind === "staff_key") {
    req.authType = "user_key";
    req.userId = req.headers["x-test-user"] ?? "user-1";
    req.orgId = "org-1";
    req.userKeyScope = { isStaff: kind === "staff_key", email: kind === "staff_key" ? "kevin.lourd@gmail.com" : "a@b.c", memberships: [] };
  }
  next();
}

function app() {
  const a = express();
  a.use(securityWatch);
  a.use(refuseTraversalPaths);
  a.use(express.json());
  a.use("/internal", adminRoutes);
  a.post("/v1/workflows", fakeAuth, markCodeBearing, requireStaffActor, (_req, res) => res.status(201).json({ ok: true }));
  a.post("/v1/api-keys", fakeAuth, (_req, res) => res.json({ key: "distrib.usr_x" }));
  a.get("/v1/things/:id", fakeAuth, (_req, res) => res.status(404).json({ error: "not found" }));
  a.use((_req, res) => res.status(404).json({ error: "not found" }));
  return a;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

async function rawGet(path: string, headers: Record<string, string>): Promise<number> {
  const server = app().listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      r.on("error", reject);
      r.end();
    });
  } finally {
    server.close();
  }
}

beforeAll(() => {
  process.env.ADMIN_DISTRIBUTE_API_KEY = PLATFORM_KEY;
  setAlertSender(async (a) => {
    alerts.push(a);
  });
  setAuditWriter(async (r) => {
    rows.push(r);
  });
});

beforeEach(() => {
  alerts = [];
  rows = [];
  resetSecurityWatch();
});

describe("path traversal", () => {
  it("the 2026-11-20 probe raises one alert per IP per day, and every attempt is audited", async () => {
    expect(await rawGet("/v1/brands/%2e%2e%2f%2e%2e%2fhealth", EDGE("203.0.113.9"))).toBe(400);
    expect(await rawGet("/v1/brands/..%2f..%2finternal/admin/services", EDGE("203.0.113.9"))).toBe(400);
    await settle();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("path_traversal");
    expect(alerts[0].eventId).toMatch(/^api-service:path_traversal:203\.0\.113\.9:\d{4}-\d{2}-\d{2}$/);
    expect(alerts[0].evidence).toContain("203.0.113.9");
    expect(alerts[0].evidence).toContain("%2e%2e%2f");
    expect(rows.filter((r) => r.kind === "path_traversal")).toHaveLength(2);
  });

  it("a normal path raises nothing", async () => {
    expect(await rawGet("/v1/things/123", EDGE("203.0.113.9"))).toBe(404);
    await settle();
    expect(alerts).toHaveLength(0);
  });
});

describe("/internal/admin/*", () => {
  it("a platform key with a customer session alerts and is audited", async () => {
    const res = await request(app())
      .get("/internal/admin/services")
      .set({ "x-api-key": PLATFORM_KEY, "x-email": "attacker@example.com", "x-external-user-id": "user_attacker" });
    expect(res.status).toBe(403);
    await settle();
    expect(alerts.map((a) => a.kind)).toEqual(["admin_not_staff_human"]);
    expect(rows.map((r) => r.kind)).toEqual(["admin_call", "admin_not_staff_human"]);
    expect(rows[0]).toMatchObject({ method: "GET", path: "/internal/admin/services", status: 403, xEmail: "attacker@example.com", externalUserId: "user_attacker" });
  });

  it("no key at all alerts too (401), case-folded paths included", async () => {
    const res = await request(app()).get("/INTERNAL/admin/services");
    expect(res.status).toBe(401);
    await settle();
    expect(alerts.map((a) => a.kind)).toEqual(["admin_not_staff_human"]);
  });

  it("a pinned staff human is audited and never alerts", async () => {
    await request(app()).get("/internal/admin/nope").set({ "x-api-key": PLATFORM_KEY, ...STAFF_HUMAN });
    await settle();
    expect(alerts).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "admin_call", staffEmail: "kevin@distribute.you" });
  });
});

describe("refused code-bearing write (RCE-WORKFLOWS-1127)", () => {
  it("a customer key posting a workflow is refused 403 and alerts once per account per day", async () => {
    const a = app();
    for (let i = 0; i < 3; i++) {
      const res = await request(a).post("/v1/workflows").set({ "x-test-auth": "user_key", "x-test-user": "attacker-user" }).send({ dag: {} });
      expect(res.status).toBe(403);
    }
    await settle();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "code_write_refused", subject: "attacker-user" });
    expect(rows.filter((r) => r.kind === "code_write_refused")).toHaveLength(3);
  });

  it("a staff key is admitted and raises nothing", async () => {
    const res = await request(app()).post("/v1/workflows").set({ "x-test-auth": "staff_key", "x-test-user": "cfe148ed" }).send({});
    expect(res.status).toBe(201);
    await settle();
    expect(alerts).toHaveLength(0);
  });
});

describe("API key mints", () => {
  it(`${KEY_MINT_BURST} mints by one account within an hour alert once; each mint is audited with its name`, async () => {
    const a = app();
    for (let i = 0; i < KEY_MINT_BURST + 1; i++) {
      await request(a).post("/v1/api-keys").set({ "x-test-auth": "user_key", "x-test-user": "new-user" }).send({ name: `probe2621${i}` });
    }
    await settle();
    expect(alerts.map((x) => x.kind)).toEqual(["key_mint_burst"]);
    const mints = rows.filter((r) => r.kind === "key_mint");
    expect(mints).toHaveLength(KEY_MINT_BURST + 1);
    expect(mints[0]).toMatchObject({ keyName: "probe26210", userId: "new-user", method: "POST", path: "/v1/api-keys" });
  });

  it(`${KEY_MINT_BURST - 1} mints raise nothing; a staff key never alerts`, async () => {
    const a = app();
    for (let i = 0; i < KEY_MINT_BURST - 1; i++) await request(a).post("/v1/api-keys").set({ "x-test-auth": "user_key" }).send({ name: "k" });
    for (let i = 0; i < KEY_MINT_BURST + 2; i++) await request(a).post("/v1/api-keys").set({ "x-test-auth": "staff_key", "x-test-user": "staff" }).send({ name: "k" });
    await settle();
    expect(alerts).toHaveLength(0);
  });
});

describe("probing burst", () => {
  it(`${PROBE_DISTINCT_4XX} distinct refused routes in 10 minutes alert once`, () => {
    const t0 = Date.parse("2026-11-20T14:10:00Z");
    for (let i = 0; i < PROBE_DISTINCT_4XX + 5; i++) {
      observe(fakeReq({ method: "GET", url: `/v1/route-${i}/x`, authType: "user_key", userId: "probe-user" }), 404, t0 + i * 1000);
    }
    expect(alerts.filter((a) => a.kind === "probe_burst")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "probe_burst")).toHaveLength(1);
  });

  it("a client retrying ONE route many times (normal max: 20 in 10 min) does not alert", () => {
    const t0 = Date.parse("2026-11-25T14:00:00Z");
    for (let i = 0; i < 50; i++) {
      observe(fakeReq({ method: "GET", url: `/v1/campaigns/1b2c3d4e-0000-4000-8000-${String(i).padStart(12, "0")}`, authType: "user_key", userId: "u" }), 404, t0 + i * 1000);
    }
    expect(alerts).toHaveLength(0);
  });

  it("refusals spread over more than 10 minutes do not alert", () => {
    const t0 = Date.parse("2026-11-25T14:00:00Z");
    for (let i = 0; i < PROBE_DISTINCT_4XX + 5; i++) {
      observe(fakeReq({ method: "GET", url: `/v1/route-${i}`, authType: "user_key", userId: "u" }), 404, t0 + i * 60_000);
    }
    expect(alerts).toHaveLength(0);
  });

  it("a sweep of made-up routes with a customer key (never authenticated) is counted under the key fingerprint", async () => {
    const a = app();
    for (let i = 0; i < PROBE_DISTINCT_4XX; i++) {
      const res = await request(a).get(`/v1/made-up-${i}`).set({ authorization: "Bearer distrib.usr_attacker", ...EDGE("203.0.113.77") });
      expect(res.status).toBe(404);
    }
    await settle();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("probe_burst");
    expect(alerts[0].subject).toMatch(/^key:[0-9a-f]{16}$/);
    expect(alerts[0].evidence).not.toContain("distrib.usr_attacker");
  });

  it("templates collapse ids", () => {
    expect(routeTemplate("GET", "/v1/brands/3f2b1c4d-1111-4222-8333-444455556666/offers/12")).toBe("GET /v1/brands/{id}/offers/{n}");
  });
});

describe("platform key source", () => {
  it("the valid platform key from an outside IP alerts once per IP per day", () => {
    const now = Date.parse("2026-11-28T10:00:00Z");
    observe(fakeReq({ method: "GET", url: "/v1/anything", authType: "admin", headers: EDGE("198.51.100.7") }), 200, now);
    observe(fakeReq({ method: "GET", url: "/v1/other", authType: "admin", headers: EDGE("198.51.100.7") }), 200, now + 1000);
    expect(alerts.map((a) => a.kind)).toEqual(["platform_key_unexpected_source"]);
    expect(alerts[0].eventId).toBe("api-service:platform_key_unexpected_source:198.51.100.7:2026-11-28");
  });

  it("our services (no edge header) and our apps (from the box's own address) raise nothing", () => {
    const now = Date.now();
    observe(fakeReq({ method: "GET", url: "/v1/x", authType: "admin" }), 200, now);
    observe(fakeReq({ method: "GET", url: "/v1/x", authType: "admin", headers: EDGE("62.83.93.230") }), 200, now);
    observe(fakeReq({ method: "GET", url: "/v1/x", authType: "admin", headers: EDGE("2a03:4000:13:1c77:7804:e4ff:fe01:4f46") }), 200, now);
    expect(alerts).toHaveLength(0);
    expect(isTrustedSourceIp("::ffff:62.83.93.230")).toBe(true);
    expect(isTrustedSourceIp("62.83.93.231")).toBe(false);
  });

  it(`${PLATFORM_KEY_GUESSES} wrong platform keys from one IP in 10 minutes alert once`, () => {
    const now = Date.now();
    for (let i = 0; i < PLATFORM_KEY_GUESSES + 3; i++) {
      observe(fakeReq({ method: "GET", url: "/v1/x", headers: { ...EDGE("192.0.2.1"), "x-api-key": `guess-${i}` } }), 401, now + i);
    }
    expect(alerts.map((a) => a.kind)).toEqual(["platform_key_guess"]);
  });
});

describe("delivery", () => {
  it("a failed delivery is retried on the next occurrence with the SAME eventId", async () => {
    const sent: string[] = [];
    let fail = true;
    setAlertSender(async (a) => {
      sent.push(a.eventId);
      if (fail) throw new Error("400 event_not_platform_staff_alert");
    });
    try {
      await rawGet("/v1/%2e%2e/x", EDGE("203.0.113.50"));
      await settle();
      fail = false;
      await rawGet("/v1/%2e%2e/x", EDGE("203.0.113.50"));
      await settle();
      await rawGet("/v1/%2e%2e/x", EDGE("203.0.113.50"));
      await settle();
      expect(sent).toHaveLength(2);
      expect(sent[0]).toBe(sent[1]);
    } finally {
      setAlertSender(async (a) => {
        alerts.push(a);
      });
    }
  });
});

function fakeReq(o: { method: string; url: string; authType?: "user_key" | "admin"; userId?: string; headers?: Record<string, string> }): any {
  return {
    method: o.method,
    originalUrl: o.url,
    url: o.url,
    headers: o.headers ?? {},
    authType: o.authType,
    userId: o.userId,
    userKeyScope: o.authType === "user_key" ? { isStaff: false } : undefined,
    body: undefined,
  };
}
