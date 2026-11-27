import { readFileSync } from "node:fs";

/**
 * Who is provably US when a security detector fires (SECURITY-OWN-ACTORS-1128, owner 2026-11-28).
 *
 * On 2026-11-28 00:36-00:42 Paris the owner got ~15 gateway "Security alert" emails, every one
 * caused by us: Claude Code sessions on his Mac replaying the 2026-11-20 attack, our staff test
 * user minting keys, a curl from the box itself. Owner rule: staff alerts never report our own
 * actions. An alert whose actor is provably us is still audited, never emailed.
 *
 * "Provably us" is a RECORDED positive fact, never a guess on shape or timing:
 *  - the request comes from the box (no edge header = a container inside the docker network;
 *    a loopback / private address = the docker bridge, e.g. a curl on the box through Caddy
 *    arrives as 172.18.0.1; the box's public address) AND relays nobody: no customer key, no
 *    forwarded session or org identity (the dashboard proxy and the MCP server also call from
 *    the box, on behalf of customers, and stay watched);
 *  - the address logged into the box over SSH with one of OUR keys in the last 24 h: the box's
 *    watcher writes them to `/root/distribute/state/security/staff-ips.json` (`{ip: lastSeenIso}`),
 *    mounted read-only into this container (`SECURITY_STAFF_IPS_FILE`);
 *  - the signed-in user is one of our staff TEST accounts below (pinned by internal user id,
 *    like `STAFF_USER_IDS`: a stored email is not proof of who someone is).
 * Anything else (an unknown address, an unknown user) alerts exactly as before.
 */

/** Box-local addresses: loopback, RFC 1918 (docker bridges), IPv6 loopback / ULA / link-local. */
export function isBoxLocalIp(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(v4);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const lower = ip.toLowerCase();
  return lower === "::1" || /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower);
}

/**
 * Our staff TEST accounts (client_service `users.id`), each created by a Clerk sign-in with an
 * address we own (a `+tag` of a staff Gmail, `@distribute.you`, the owner's pressbeat test user).
 * A new test account that should never alert = add its id here.
 */
export const OWN_TEST_USER_IDS: Readonly<Record<string, string>> = {
  "d0855655-d7a4-41b5-af49-e2dd357b60fe": "kevin@pressbeat.io",
  "65581d91-3303-4fba-97c1-ce259a52ebe9": "kevin+invitetest2@distribute.you",
  "3207bfa9-4d8c-4737-9725-53a79350a2a6": "kevin+teamjoiner@distribute.you",
  "e723008b-fa11-48fd-91cc-892ead274ff2": "kevin+teamjoiner@distribute.you",
  "b839c1c9-1106-466f-a691-fedc1db6013d": "probe-onboarding-1002104731@distribute.you",
  "324db643-3744-4316-b117-6f3d3303c199": "kevin.lourd+jlc6@gmail.com",
  "a6317e91-2549-4e96-84e2-a351ee08425e": "kevin.lourd+joinfix2claimer1014@gmail.com",
  "bb5f8639-c59a-4d03-a274-6d4453019c82": "kevin.lourd+jlc7@gmail.com",
  "9687cea5-a904-4978-9a7f-ea9f090c3071": "kevin.lourd+jlcold@gmail.com",
  "d2364c3d-1322-4ac5-ab00-96e692daf257": "kevin.lourd+jlc1@gmail.com",
  "9c0dca14-658b-4a15-9c93-49563daba6de": "kevin.lourd+jlc2@gmail.com",
  "eeee4871-fec3-4614-ab38-9e061fa97168": "kevin.lourd+jlc3@gmail.com",
  "8c09945f-71c7-4d61-af51-4597f5d753c4": "kevin.lourd+joinfixbase1014@gmail.com",
  "2284454a-3cb9-4466-a921-7be5dd314926": "kevin.lourd+joinold1014@gmail.com",
  "be5389a1-0930-459e-8d6a-86512e9c016f": "kevin.lourd+joinnew1014@gmail.com",
  "bea0a521-b2c1-4586-ae5f-4cbfbb3b3e51": "kevin.lourd+jlc4@gmail.com",
  "6bf09789-4f85-4570-83e6-6691a7d74994": "kevin.lourd+jlcfinal@gmail.com",
  "728bf4cc-0cea-412b-9be7-bdb1c7a1eda6": "kevin.lourd+jlcnew@gmail.com",
  "22f42191-0d59-4f83-bf8f-6319989a3354": "kevin.lourd+joinfix2page1014@gmail.com",
  "1e083093-cd6b-449a-b5e9-5d9fd8c8a621": "kevin.lourd+jlc8@gmail.com",
  "d5299b91-f282-4882-8e76-1b2017cf9bea": "kevin.lourd+e2eclient1014@gmail.com",
  "b9b1bdfa-9676-4372-b8cc-791596939265": "kevin+sophietest@distribute.you",
  "e6c602f5-b483-4216-9c8e-9c9b7cbbfd07": "kevin.lourd+agentbase@gmail.com",
  "38959d1a-f847-43c8-830c-985e871a90f5": "kevin.lourd+mobileaudit@gmail.com",
  "19ca5557-b011-4884-b768-2c34f2cdd7b1": "kevin.lourd+mobileaudit2@gmail.com",
  "299cff9b-794d-43ff-a20e-a8898145d7cf": "kevin.lourd+speedaudit@gmail.com",
  "1e4a9596-d165-44f4-a143-91560cc55eb4": "kevin.lourd+speedcheck@gmail.com",
  "25de157e-e9ce-4cf8-992a-ef5b7d9ad3ae": "kevin.lourd+blk1110@gmail.com",
  "dfd18c7a-a480-4ff6-a15a-f70e92d0ed1c": "kevin.lourd+solo1125b@gmail.com",
  "cfc0ef87-236c-4fd5-9dd3-f6100bda52d3": "kevin.lourd+solo1125@gmail.com",
  "53774e4f-2f95-4bb8-942a-d90718c73717": "kevin.lourd+solo1125c@gmail.com",
  "dc828719-cb2b-4b96-b7ee-90d8d3efd893": "kevin.lourd+solo1125d@gmail.com",
  "2b7c40a3-2374-40ee-b0ad-449b92072216": "kevin.lourd+solo1125e@gmail.com",
  "2a4fb053-ddaf-439a-ad5d-1eebe2896a1d": "kevin.lourd+solo1125f@gmail.com",
  "52ad7335-c47d-4130-8672-bc173821e1ce": "kevin.lourd+solo1125g@gmail.com",
  "cd277207-b3ea-4dac-a209-e8b7024bf9b8": "kevin.lourd+solo1125j@gmail.com",
  "b77ee1e0-5568-435f-9bbf-b0c9b9820487": "kevin.lourd+solo1125i@gmail.com",
};

export function isOwnTestUser(userId: string | null | undefined): boolean {
  return !!userId && Object.prototype.hasOwnProperty.call(OWN_TEST_USER_IDS, userId);
}

// ── The box's list of addresses that logged in with our SSH keys ────────────

export const STAFF_IP_TTL_MS = 24 * 3_600_000;
const RELOAD_MS = 30_000;
const DEFAULT_STAFF_IPS_FILE = "/box-security/staff-ips.json";

let cache: { at: number; entries: Record<string, string> } | null = null;
let lastReadError: string | null = null;

function staffIpsFile(): string {
  return process.env.SECURITY_STAFF_IPS_FILE?.trim() || DEFAULT_STAFF_IPS_FILE;
}

/**
 * Read the box's staff-IP list (re-read every 30 s: the watcher replaces it atomically). A
 * missing or unreadable file means NO address is known as ours, so alerts still go out; the
 * error is logged once per distinct message, never swallowed silently.
 */
function staffIpEntries(now: number): Record<string, string> {
  if (cache && now - cache.at < RELOAD_MS) return cache.entries;
  let entries: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(staffIpsFile(), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [ip, seen] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof seen === "string") entries[ip] = seen;
      }
    }
    lastReadError = null;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg !== lastReadError) console.error(`[security-own-actors] staff IP list unreadable (${staffIpsFile()}): ${msg}`);
    lastReadError = msg;
    entries = {};
  }
  cache = { at: now, entries };
  return entries;
}

/** The address logged into the box with one of our SSH keys within the last 24 h. */
export function isStaffSshIp(ip: string, now: number = Date.now()): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const seen = staffIpEntries(now)[v4];
  if (!seen) return false;
  const at = Date.parse(seen);
  return Number.isFinite(at) && now - at < STAFF_IP_TTL_MS;
}

/** Tests only: drop the cached file read. */
export function resetOwnActorsCache(): void {
  cache = null;
  lastReadError = null;
}

/**
 * Headers by which a request relays SOMEONE ELSE: the dashboard/admin proxies (customer Clerk
 * session), the MCP server and our services acting for an org all call from inside the box. A
 * request carrying any of them is that person's act, not ours, wherever it comes from on the box
 * (the 2026-11-20 traversal went through the customer dashboard proxy).
 */
const RELAYED_IDENTITY_HEADERS = ["authorization", "x-external-user-id", "x-external-org-id", "x-email", "x-org-id", "x-user-id"];

export interface ActorFacts {
  /** Edge client address (`edgeClientIp`); null when the request never crossed the edge. */
  ip: string | null;
  /** Internal user id set by `authenticate`, if any. */
  userId?: string | null;
  authType?: "user_key" | "admin";
  headers: Record<string, string | string[] | undefined>;
  /** The box's own public addresses count as the box (`isTrustedSourceIp`). */
  isBoxPublicIp?: (ip: string) => boolean;
}

function relaysSomeone(f: ActorFacts): boolean {
  if (f.authType === "user_key") return true;
  return RELAYED_IDENTITY_HEADERS.some((h) => {
    const v = f.headers[h];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.trim() !== "";
  });
}

/** Why this request's actor is provably us, or null (then it alerts as before). */
export function ownActorReason(f: ActorFacts, now: number = Date.now()): string | null {
  if (isOwnTestUser(f.userId)) return `our staff test account ${OWN_TEST_USER_IDS[f.userId as string]}`;
  if (f.ip !== null && isStaffSshIp(f.ip, now)) return `${f.ip} logged into our server with our SSH key in the last 24 h`;
  const fromBox = f.ip === null || isBoxLocalIp(f.ip) || !!f.isBoxPublicIp?.(f.ip);
  if (fromBox && !relaysSomeone(f)) {
    return f.ip === null ? "a request from inside our server network, relaying nobody" : `a request from our own server (${f.ip}), relaying nobody`;
  }
  return null;
}
