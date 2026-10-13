import { Router, type Response } from "express";
import {
  authenticate,
  authenticateUser,
  requireOrg,
  requireStaffActor,
  requireUser,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { callExternalService, pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";
import { isStaffEmail } from "../lib/staff.js";

/**
 * Organizations and their member invitations → client-service.
 *
 * - `POST /v1/orgs` → `POST /internal/orgs`: create an organization for a new
 *   client (staff only: `requireStaffActor`, a staff member's own key or the
 *   staff console; listed in `STAFF_KEY_OPERATIONS`). Owner rule 2026-10-12
 *   (`mcp-first`): staff open a client's account through the MCP like a client
 *   would. No org target: the caller is creating one.
 * - `POST|GET /v1/orgs/:orgId/member-invitations`, `DELETE
 *   .../:invitationId` → the same paths under `/internal`: any member of the org
 *   (clients too) invites a person by email and gets the link back, lists the
 *   pending invitations, revokes one. `:orgId` is the request's target, resolved
 *   and membership-checked by `authenticate`; the downstream path carries the
 *   AUTHENTICATED org.
 *
 * - `POST /v1/orgs/:orgId/members` → `POST /internal/orgs/:orgId/members`, then
 *   key-service `POST /api-keys`: staff add a person (by email) to a client's org
 *   WITHOUT any email reaching them, and get back an API key that belongs to THAT
 *   PERSON, to hand over (and test first). Staff only (`requireStaffActor`,
 *   `STAFF_KEY_OPERATIONS`); the staff caller is usually not a member of the
 *   org, so `:orgId` is NOT a request target: `authenticateUser` (no target),
 *   the path org goes straight downstream and client-service 404s an unknown
 *   one. The key is a plain user key: it reaches the orgs that person is a
 *   member of and nothing else. It must never carry staff powers, and the
 *   gateway owns the staff allowlist, so a staff email is refused BEFORE the
 *   membership (`staff_email_refused`) and the resulting user is re-read with
 *   the SAME predicate the key auth uses (`loadUserKeyScope`: client-service
 *   user email ∈ `STAFF_EMAILS`) before any key is minted. The answer is built
 *   here (membership + key), so its schema is typed (rule #8 exception, like
 *   `agent-signups.ts`).
 *
 * The acting user is identity, so the gateway supplies it from `authenticate`
 * (`createdByUserId` / `invitedByUserId`, client-service's body names for the
 * gateway's `x-user-id`), spread-then-override like `/orgs/:orgId/invites/claim`:
 * a caller-supplied value is discarded, every other body field passes through.
 * Responses are piped byte-identical with their status (201 created, 200
 * idempotent replay, 4xx refusals with `error` + `message`).
 */
const router = Router();

function pathOrgMismatch(req: AuthenticatedRequest, res: Response): boolean {
  if (req.params.orgId === req.orgId) return false;
  res.status(403).json({
    error: "org_mismatch",
    message: "The organization in the path is not the one this request is authenticated for.",
  });
  return true;
}

router.post("/orgs", authenticateUser, requireUser, requireStaffActor, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(externalServices.client, "/internal/orgs", {
      expressRes: res,
      method: "POST",
      body: { ...req.body, createdByUserId: req.userId },
      headers: buildInternalHeaders(req),
    });
  } catch (error) {
    respondUpstreamError(res, error, "Failed to create the organization");
  }
});

router.post(
  "/orgs/:orgId/member-invitations",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    if (pathOrgMismatch(req, res)) return;
    try {
      await pipeExternalService(
        externalServices.client,
        `/internal/orgs/${encodeURIComponent(req.orgId!)}/member-invitations`,
        {
          expressRes: res,
          method: "POST",
          body: { ...req.body, invitedByUserId: req.userId },
          headers: buildInternalHeaders(req),
        },
      );
    } catch (error) {
      respondUpstreamError(res, error, "Failed to invite the person");
    }
  },
);

router.get(
  "/orgs/:orgId/member-invitations",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    if (pathOrgMismatch(req, res)) return;
    try {
      await pipeExternalService(
        externalServices.client,
        `/internal/orgs/${encodeURIComponent(req.orgId!)}/member-invitations`,
        { expressRes: res, headers: buildInternalHeaders(req) },
      );
    } catch (error) {
      respondUpstreamError(res, error, "Failed to list the invitations");
    }
  },
);

router.delete(
  "/orgs/:orgId/member-invitations/:invitationId",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    if (pathOrgMismatch(req, res)) return;
    try {
      await pipeExternalService(
        externalServices.client,
        `/internal/orgs/${encodeURIComponent(req.orgId!)}/member-invitations/${encodeURIComponent(req.params.invitationId)}`,
        { expressRes: res, method: "DELETE", headers: buildInternalHeaders(req) },
      );
    } catch (error) {
      respondUpstreamError(res, error, "Failed to revoke the invitation");
    }
  },
);

interface AddedMember {
  member: { userId: string; clerkUserId: string; email: string; orgId: string; role: string };
  userCreated: boolean;
  membershipCreated: boolean;
}

interface MintedKey {
  id: string;
  key: string;
  name: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function staffRefusal(res: Response) {
  return res.status(422).json({
    error: "staff_email_refused",
    message:
      "This email belongs to a distribute.you staff member. A key handed out from here must never carry staff powers: pick the client's own email.",
  });
}

router.post("/orgs/:orgId/members", authenticateUser, requireUser, requireStaffActor, async (req: AuthenticatedRequest, res) => {
  const body = isObject(req.body) ? req.body : {};
  const { keyName, ...forwarded } = body;
  if (typeof forwarded.email !== "string" || forwarded.email.trim() === "") {
    return res.status(400).json({ error: "invalid_request", message: "email is required: the person to add to the organization." });
  }
  if (keyName !== undefined && (typeof keyName !== "string" || keyName.trim() === "")) {
    return res.status(400).json({ error: "invalid_request", message: "keyName, when given, must be a non-empty string." });
  }
  if (isStaffEmail(forwarded.email)) return staffRefusal(res);

  const orgId = req.params.orgId;
  let added: AddedMember;
  let status: number;
  try {
    added = await callExternalService<AddedMember>(
      externalServices.client,
      `/internal/orgs/${encodeURIComponent(orgId)}/members`,
      { method: "POST", body: forwarded, headers: buildInternalHeaders(req) },
    );
    status = added.membershipCreated ? 201 : 200;
  } catch (error) {
    return respondUpstreamError(res, error, "Failed to add the person to the organization");
  }

  // Same predicate as the key auth (org-scope.ts loadUserKeyScope): the stored
  // email of the user the key will belong to. A staff user is refused here
  // even when the email sent was another of their addresses.
  let userEmail: string | null;
  try {
    const user = await callExternalService<{ user: { email: string | null } }>(
      externalServices.client,
      `/internal/users/${encodeURIComponent(added.member.userId)}`,
    );
    userEmail = user.user.email ?? null;
  } catch (error) {
    return respondUpstreamError(res, error, "Could not check the person's account before creating their key");
  }
  if (isStaffEmail(userEmail) || isStaffEmail(added.member.email)) return staffRefusal(res);

  let minted: MintedKey;
  try {
    minted = await callExternalService<MintedKey>(externalServices.key, "/api-keys", {
      method: "POST",
      headers: { "x-org-id": added.member.orgId, "x-user-id": added.member.userId },
      body: {
        userId: added.member.userId,
        createdBy: req.userId,
        name: (keyName as string | undefined)?.trim() || `Key for ${added.member.email} ${new Date().toISOString()}`,
      },
    });
  } catch (error) {
    console.error(`[orgs] key minting failed for user ${added.member.userId} in org ${added.member.orgId}:`, (error as Error).message);
    return res.status(502).json({
      error: "key_minting_failed",
      message: "The person is a member of the organization but no API key could be created. Call again with the same email: the membership is kept and a key is minted.",
      member: added.member,
    });
  }

  res.status(status).json({
    member: added.member,
    userCreated: added.userCreated,
    membershipCreated: added.membershipCreated,
    apiKey: minted.key,
    apiKeyId: minted.id,
    apiKeyName: minted.name,
    usage: "The person sends it as `Authorization: Bearer <apiKey>` (Claude Code / the distribute MCP). It reaches only the organizations this person is a member of. First call: GET /v1/me.",
  });
});

export default router;
