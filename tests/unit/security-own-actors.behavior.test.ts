import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";

/**
 * SECURITY-OWN-ACTORS-1128. On 2026-11-28 00:36-00:42 Paris the owner got ~15 gateway security
 * emails, all caused by us: Claude Code sessions on his Mac (94.131.226.180, logged into the box
 * with our SSH key) replaying the 2026-11-20 attack, our staff test user d5299b91
 * (kevin.lourd+e2eclient1014) minting its 3rd key `forensics-1127-replay`, and a curl on the box
 * itself (172.18.0.1). These tests replay each one through the REAL security watch: from us they
 * send 0 emails (still audited as `own_<kind>`); the same event from an unknown address or user
 * still emails exactly as before.
 */

import {
  securityWatch,
  markCodeBearing,
  setAlertSender,
  resetSecurityWatch,
  observe,
  PROBE_DISTINCT_4XX,
  KEY_MINT_BURST,
  PLATFORM_KEY_GUESSES,
  type SecurityAlert,
} from "../../src/lib/security-watch.js";
import { ownActorReason, isBoxLocalIp } from "../../src/lib/own-actors.js";
import { setAuditWriter, type AuditRow } from "../../src/lib/security-audit-store.js";
import { refuseTraversalPaths } from "../../src/middleware/path-guard.js";
import { requireStaffActor } from "../../src/middleware/auth.js";
import adminRoutes from "../../src/routes/admin.js";

const PLATFORM_KEY = "own-actors-platform-key";
const KEVIN_MAC = "94.131.226.180";
const OUTSIDER = "203.0.113.66";
const STAFF_TEST_USER = "d5299b91-f282-4882-8e76-1b2017cf9bea";
const EDGE = (ip: string) => ({ "cf-connecting-ip": ip });
const XFF = (ip: string) => ({ "x-forwarded-for": ip });

let alerts: SecurityAlert[] = [];
let rows: AuditRow[] = [];
let dir: string;
let staffIpsFile: string;

function writeStaffIps(entries: Record<string, string>) {
  writeFileSync(staffIpsFile, JSON.stringify(entries));
  resetSecurityWatch();
}

function fakeAuth(req: any, _res: any, next: any) {
  if (req.headers["x-test-auth"] === "user_key") {
    req.authType = "user_key";
    req.userId = req.headers["x-test-user"];
    req.orgId = "org-1";
    req.userKeyScope = { isStaff: false, email: "x@example.com", memberships: [] };
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
  a.use((_req, res) => res.status(404).json({ error: "not found" }));
  return a;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

function fakeReq(o: { url: string; authType?: "user_key" | "admin"; userId?: string; headers?: Record<string, string> }): any {
  return { method: "GET", originalUrl: o.url, url: o.url, headers: o.headers ?? {}, authType: o.authType, userId: o.userId, userKeyScope: o.authType === "user_key" ? { isStaff: false } : undefined };
}

beforeAll(() => {
  process.env.ADMIN_DISTRIBUTE_API_KEY = PLATFORM_KEY;
  dir = mkdtempSync(join(tmpdir(), "own-actors-"));
  staffIpsFile = join(dir, "staff-ips.json");
  process.env.SECURITY_STAFF_IPS_FILE = staffIpsFile;
  setAlertSender(async (a) => {
    alerts.push(a);
  });
  setAuditWriter(async (r) => {
    rows.push(r);
  });
});

afterAll(() => {
  delete process.env.SECURITY_STAFF_IPS_FILE;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  alerts = [];
  rows = [];
  writeStaffIps({ [KEVIN_MAC]: new Date().toISOString() });
});

/** Tonight's gateway alerts, replayed with a chosen client address and user. */
async function replayTonight(ip: string, user: string) {
  const a = app();
  const now = Date.now();
  // "The platform API key was used from <ip>, an address outside our server"
  observe(fakeReq({ url: "/v1/anything", authType: "admin", headers: EDGE(ip) }), 200, now);
  // "10 wrong platform keys from <ip>"
  for (let i = 0; i < PLATFORM_KEY_GUESSES; i++) {
    observe(fakeReq({ url: "/v1/x", headers: { ...EDGE(ip), "x-api-key": `guess-${i}` } }), 401, now + i);
  }
  // "non-staff caller called GET /internal/admin/services from <ip>"
  await request(a).get("/internal/admin/services").set({ ...EDGE(ip), "x-api-key": PLATFORM_KEY, "x-email": "replay@example.com" });
  // "non-staff caller POST /v1/workflows refused 403"
  await request(a).post("/v1/workflows").set({ ...EDGE(ip), "x-test-auth": "user_key", "x-test-user": user }).send({ dag: {} });
  // "One account got 20 refusals on 20 different routes"
  for (let i = 0; i < PROBE_DISTINCT_4XX; i++) {
    observe(fakeReq({ url: `/v1/route-${i}`, authType: "user_key", userId: user, headers: EDGE(ip) }), 404, now + i);
  }
  // "One account minted 3 API keys within an hour"
  for (let i = 0; i < KEY_MINT_BURST; i++) {
    await request(a).post("/v1/api-keys").set({ ...EDGE(ip), "x-test-auth": "user_key", "x-test-user": user }).send({ name: i === 2 ? "forensics-1127-replay" : `k${i}` });
  }
  await settle();
}

const TONIGHT_KINDS = ["platform_key_unexpected_source", "platform_key_guess", "admin_not_staff_human", "code_write_refused", "probe_burst", "key_mint_burst"];

describe("tonight's replay from us sends 0 emails", () => {
  it("from Kevin's Mac (logged into the box with our SSH key in the last 24 h): 0 alerts, every detection audited as own_<kind>", async () => {
    await replayTonight(KEVIN_MAC, "some-user");
    expect(alerts).toHaveLength(0);
    const ownKinds = new Set(rows.filter((r) => r.kind.startsWith("own_")).map((r) => r.kind.slice(4)));
    expect([...ownKinds].sort()).toEqual([...TONIGHT_KINDS].sort());
  });

  it("our staff test user (d5299b91, kevin.lourd+e2eclient1014) from any address: 0 alerts for its account-keyed detections", async () => {
    const a = app();
    for (let i = 0; i < KEY_MINT_BURST; i++) {
      await request(a).post("/v1/api-keys").set({ ...EDGE(OUTSIDER), "x-test-auth": "user_key", "x-test-user": STAFF_TEST_USER }).send({ name: "forensics-1127-replay" });
    }
    await request(a).post("/v1/workflows").set({ ...EDGE(OUTSIDER), "x-test-auth": "user_key", "x-test-user": STAFF_TEST_USER }).send({});
    for (let i = 0; i < PROBE_DISTINCT_4XX; i++) {
      observe(fakeReq({ url: `/v1/route-${i}`, authType: "user_key", userId: STAFF_TEST_USER, headers: EDGE(OUTSIDER) }), 404, Date.now() + i);
    }
    await settle();
    expect(alerts).toHaveLength(0);
    expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(["own_key_mint_burst", "own_code_write_refused", "own_probe_burst"]));
  });

  it("the 'path tricks' curl from the box's docker bridge (172.18.0.1) relaying nobody: 0 alerts, audited", async () => {
    const res = await request(app()).get("/v1/brands/..%2f..%2finternal/admin/services").set({ ...XFF("172.18.0.1"), "user-agent": "curl/8.5.0" });
    expect(res.status).toBe(400);
    await settle();
    expect(alerts).toHaveLength(0);
    expect(rows.map((r) => r.kind)).toEqual(["own_path_traversal"]);
  });

  it("a sibling container (no edge header) relaying nobody: 0 alerts", async () => {
    await request(app()).get("/internal/admin/services").set({ "x-api-key": "wrong" });
    await settle();
    expect(alerts).toHaveLength(0);
  });
});

describe("the same events from an outsider still email exactly as before", () => {
  it("unknown address + unknown user: every one of tonight's alerts is sent, once", async () => {
    await replayTonight(OUTSIDER, "stranger-user");
    expect(alerts.map((a) => a.kind).sort()).toEqual([...TONIGHT_KINDS].sort());
    expect(rows.some((r) => r.kind.startsWith("own_"))).toBe(false);
  });

  it("an address that logged in with our key MORE than 24 h ago is an outsider again", async () => {
    writeStaffIps({ [KEVIN_MAC]: new Date(Date.now() - 25 * 3_600_000).toISOString() });
    await replayTonight(KEVIN_MAC, "stranger-user");
    expect(alerts.map((a) => a.kind).sort()).toEqual([...TONIGHT_KINDS].sort());
  });

  it("a missing staff-IP list knows no address as ours: alerts go out", async () => {
    rmSync(staffIpsFile, { force: true });
    resetSecurityWatch();
    await replayTonight(KEVIN_MAC, "stranger-user");
    expect(alerts.map((a) => a.kind).sort()).toEqual([...TONIGHT_KINDS].sort());
  });

  it("a customer relayed THROUGH the box (dashboard proxy session, MCP customer key) still alerts", async () => {
    // Dashboard proxy: inside the docker network, a customer's Clerk session stamped.
    const r1 = await request(app())
      .get("/v1/brands/..%2f..%2finternal/admin/services")
      .set({ "x-api-key": PLATFORM_KEY, "x-external-user-id": "user_attacker", "x-email": "attacker@example.com" });
    expect(r1.status).toBe(400);
    // Through Caddy on the box with a customer bearer key (MCP).
    await request(app()).get("/v1/brands/..%2fx").set({ ...XFF("172.18.0.5"), authorization: "Bearer distrib.usr_attacker" });
    // MCP relays a customer key from inside the network: its probing is the customer's.
    for (let i = 0; i < PROBE_DISTINCT_4XX; i++) {
      observe(fakeReq({ url: `/v1/route-${i}`, authType: "user_key", userId: "mcp-customer" }), 404, Date.now() + i);
    }
    await settle();
    expect(alerts.map((a) => a.kind)).toEqual(["path_traversal", "path_traversal", "probe_burst"]);
  });

  it("an own-actor detection never consumes the day's alert: the outsider on the same subject still alerts", () => {
    const now = Date.now();
    for (let i = 0; i < PROBE_DISTINCT_4XX; i++) {
      observe(fakeReq({ url: `/v1/r-${i}`, authType: "user_key", userId: "shared-user", headers: EDGE(KEVIN_MAC) }), 404, now + i);
    }
    expect(alerts).toHaveLength(0);
    for (let i = 0; i < PROBE_DISTINCT_4XX; i++) {
      observe(fakeReq({ url: `/v1/r-${i}`, authType: "user_key", userId: "shared-user", headers: EDGE(OUTSIDER) }), 404, now + 100 + i);
    }
    expect(alerts.map((a) => a.kind)).toEqual(["probe_burst"]);
  });
});

describe("own-actor facts", () => {
  it("box-local addresses are loopback, RFC 1918 and IPv6 local only", () => {
    for (const ip of ["127.0.0.1", "172.18.0.1", "10.0.0.4", "192.168.1.2", "::1", "::ffff:172.18.0.1", "fd00::1", "fe80::1"]) expect(isBoxLocalIp(ip)).toBe(true);
    for (const ip of ["172.32.0.1", "94.131.226.180", "203.0.113.1", "2a03:4000::1", "11.0.0.1"]) expect(isBoxLocalIp(ip)).toBe(false);
  });

  it("the box's public address counts as the box only when it relays nobody", () => {
    const box = (ip: string) => ip === "62.83.93.230";
    expect(ownActorReason({ ip: "62.83.93.230", headers: {}, isBoxPublicIp: box })).toMatch(/our own server/);
    expect(ownActorReason({ ip: "62.83.93.230", headers: { "x-external-org-id": "org_x" }, isBoxPublicIp: box })).toBeNull();
    expect(ownActorReason({ ip: null, headers: {}, authType: "user_key", userId: "u" })).toBeNull();
    expect(ownActorReason({ ip: OUTSIDER, headers: {} })).toBeNull();
  });
});
