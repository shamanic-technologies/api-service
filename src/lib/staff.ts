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
