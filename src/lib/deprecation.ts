/**
 * Deprecation / sunset signalling.
 *
 * The policy this implements (also published in the OpenAPI `info.description`
 * and as the machine-readable `x-deprecation-policy` extension at the document
 * root, so an agent can read it before it integrates):
 *
 * - A deprecated operation keeps working. Deprecation is an announcement, not a
 *   removal.
 * - It is marked `deprecated: true` in the OpenAPI document, and every response
 *   it returns carries `Deprecation` (RFC 9745) and `Sunset` (RFC 8594), plus a
 *   `Link` with `rel="deprecation"` pointing at the replacement or the changelog.
 * - `MINIMUM_NOTICE_DAYS` is the floor between the `Deprecation` date and the
 *   `Sunset` date. Nothing is removed before its sunset date passes.
 * - Removal is a `major`-version event; the URL version prefix (`/v1`) never
 *   changes meaning under a caller.
 *
 * Nothing is deprecated today. This module is the mechanism the policy promises,
 * so that the first deprecation is a two-line change on one route rather than a
 * design exercise, and so the policy is not a claim with no implementation
 * behind it.
 */
import { Response } from "express";

/** Minimum days between announcing a deprecation and sunsetting the operation. */
export const MINIMUM_NOTICE_DAYS = 180;

/** Where the human-readable policy and changelog live. */
export const DEPRECATION_POLICY_URL = "https://api.distribute.you/docs#deprecation-policy";

export interface DeprecationNotice {
  /** When the operation was announced as deprecated. */
  deprecatedAt: Date;
  /** Earliest date the operation may stop working. */
  sunsetAt: Date;
  /**
   * Successor operation or changelog entry. Defaults to the policy page.
   * Emitted as `Link: <url>; rel="deprecation"`.
   */
  link?: string;
}

/** Machine-readable policy, embedded at the OpenAPI document root. */
export const DEPRECATION_POLICY = {
  policyUrl: DEPRECATION_POLICY_URL,
  minimumNoticeDays: MINIMUM_NOTICE_DAYS,
  versioning: "url-path",
  currentVersion: "v1",
  signals: {
    openapi: "The operation carries `deprecated: true` in this document.",
    deprecationHeader:
      "`Deprecation: @<unix-seconds>` (RFC 9745) on every response from a deprecated operation.",
    sunsetHeader:
      "`Sunset: <HTTP-date>` (RFC 8594) — the earliest date the operation may stop working.",
    linkHeader:
      '`Link: <url>; rel="deprecation"` — the replacement operation or changelog entry.',
  },
} as const;

/**
 * Attach the deprecation signals for `notice` to a response.
 *
 * Call it at the top of a deprecated route handler, before the response is sent:
 *
 *   router.get("/v1/old-thing", (req, res) => {
 *     signalDeprecation(res, {
 *       deprecatedAt: new Date("2026-09-01T00:00:00Z"),
 *       sunsetAt: new Date("2027-03-01T00:00:00Z"),
 *       link: "https://api.distribute.you/docs#new-thing",
 *     });
 *     ...
 *   });
 */
export function signalDeprecation(res: Response, notice: DeprecationNotice): void {
  res.setHeader("Deprecation", `@${Math.floor(notice.deprecatedAt.getTime() / 1000)}`);
  res.setHeader("Sunset", notice.sunsetAt.toUTCString());
  res.setHeader(
    "Link",
    `<${notice.link ?? DEPRECATION_POLICY_URL}>; rel="deprecation"`,
  );
}

/** Whether a notice honours the published minimum-notice floor. */
export function honoursMinimumNotice(notice: DeprecationNotice): boolean {
  const days = (notice.sunsetAt.getTime() - notice.deprecatedAt.getTime()) / 86_400_000;
  return days >= MINIMUM_NOTICE_DAYS;
}
