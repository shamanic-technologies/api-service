/**
 * Canonical staff allowlist — hardcoded in source (NOT an env var), so the
 * staff set lives in the repo and cannot drift / be forgotten on a host.
 * These are the only emails that pass `requireStaff`, and the only users whose
 * API key counts them as members of every organization (`org-scope.ts`).
 */
export const STAFF_EMAILS = [
  "kevin.lourd@gmail.com",
  "kevin@distribute.you",
] as const;

/** Normalized lowercase Set of the hardcoded staff allowlist. */
export function staffEmailAllowlist(): Set<string> {
  return new Set(
    STAFF_EMAILS.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0),
  );
}

export function isStaffEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return !!normalized && staffEmailAllowlist().has(normalized);
}

/**
 * The client-service user rows that ARE the staff, pinned by internal user id
 * (SEC-STAFF-EMAIL-1120, security hotfix 2026-11-20).
 *
 * A user's stored email is NOT proof of who they are: any customer could create
 * a user carrying a staff address through `POST /v1/users/resolve` (incident
 * 2026-11-20: org 3afacd9a… minted user a4651533… as kevin.lourd@gmail.com), and
 * an internal probe left one more such row (`system-probe-crm-merged`). So a
 * USER KEY counts as staff only when its user is one of these rows, each created
 * by a Clerk sign-in whose primary email Clerk verified, AND its stored email is
 * still on the allowlist. A new staff account = sign in once on the dashboard,
 * then add its internal id here (client_service `users.id`, `external_id` must
 * be a Clerk `user_…` id).
 *
 * The platform-key path (`requireStaff`) is unchanged: there the email is the
 * `x-email` our own dashboard/admin proxies stamp from the verified Clerk
 * session, never a value a customer stores.
 */
export const STAFF_USER_IDS: Readonly<Record<string, (typeof STAFF_EMAILS)[number]>> = {
  "cfe148ed-e3d8-40a2-8920-f8c040a81934": "kevin.lourd@gmail.com", // Clerk user_3AI7TH7LLPltlSpF2UCTD5U1lLa
  "7b417d70-29b5-471b-a8e1-20e75225c0af": "kevin@distribute.you", // Clerk user_2yaCEpxeoOEIfXTdxTMY8pM8jXW
};

/** A user key's user is staff: a pinned staff user id whose stored email is that staff address. */
export function isStaffUser(userId: string | null | undefined, storedEmail: string | null | undefined): boolean {
  if (!userId || !Object.prototype.hasOwnProperty.call(STAFF_USER_IDS, userId)) return false;
  return storedEmail?.trim().toLowerCase() === STAFF_USER_IDS[userId];
}

/**
 * The Clerk user ids (`x-external-user-id`) of the staff HUMANS, each pinned to its staff
 * email (SECRETS-ROTATE-1127, security hotfix 2026-11-27).
 *
 * The platform key is held by every browser-facing proxy (dashboard `/api/v1`, admin) and
 * was leaked once; a request carrying it says nothing about WHO is behind it. Raw-data
 * operations (`/internal/admin/*`, `requireStaffHuman`) therefore also demand the verified
 * Clerk session our proxies stamp as `x-external-user-id` to be one of these, with the
 * matching `x-email`. Same accounts as `STAFF_USER_IDS` (their `external_id`).
 */
export const STAFF_EXTERNAL_USER_IDS: Readonly<Record<string, (typeof STAFF_EMAILS)[number]>> = {
  user_3AI7TH7LLPltlSpF2UCTD5U1lLa: "kevin.lourd@gmail.com",
  user_2yaCEpxeoOEIfXTdxTMY8pM8jXW: "kevin@distribute.you",
};

/** A forwarded Clerk user id + email pair is a pinned staff human. */
export function isStaffHuman(externalUserId: string | null | undefined, email: string | null | undefined): boolean {
  const id = externalUserId?.trim();
  if (!id || !Object.prototype.hasOwnProperty.call(STAFF_EXTERNAL_USER_IDS, id)) return false;
  return email?.trim().toLowerCase() === STAFF_EXTERNAL_USER_IDS[id];
}
