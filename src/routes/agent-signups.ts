import { Router } from "express";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";
import { prepayInstructions } from "../lib/agent-prepay.js";

/**
 * Public signup for AI agents: email + phone → 6-digit code by email → API key.
 *
 * Owner 2026-10-12: "an API key could be requested just against a valid email
 * ... create as many API keys as needed, and then install API/MCP based on that
 * key without a human needing to do anything". No CAPTCHA, no caps (owner).
 *
 * Deliberately NO middleware: the caller has no key yet (CLAUDE.md rule #3,
 * public tier). client-service owns the code, the account and the "no free
 * credit" mark; key-service mints the key. Every completion mints a NEW key
 * (an email that already has an account gets one more key for it).
 *
 * `POST /v1/agent-signups/complete` is the one response this gateway builds
 * itself (account from client-service + key from key-service), so its schema is
 * typed, not passthrough (rule #8 exception: construction site is this file).
 */
const router = Router();

interface AgentSignupAccount {
  orgId: string;
  userId: string;
  email: string;
  contactPhone: string | null;
  created: boolean;
}

interface MintedKey {
  id: string;
  key: string;
  name: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// POST /v1/agent-signups/start → client-service POST /internal/agent-signups/start
router.post("/agent-signups/start", async (req, res) => {
  try {
    const result = await callExternalService(externalServices.client, "/internal/agent-signups/start", {
      method: "POST",
      body: req.body,
    });
    res.json(result);
  } catch (error) {
    console.error("[agent-signups] start error:", (error as Error).message);
    respondUpstreamError(res, error, "Failed to send the signup code");
  }
});

// POST /v1/agent-signups/complete → client-service POST /internal/agent-signups/complete,
// then key-service POST /api-keys for the returned org + user.
router.post("/agent-signups/complete", async (req, res) => {
  const body = isObject(req.body) ? req.body : {};
  const keyName = body.keyName;
  if (keyName !== undefined && (typeof keyName !== "string" || keyName.trim() === "")) {
    return res.status(400).json({
      error: "invalid_request",
      message: "keyName, when given, must be a non-empty string.",
    });
  }

  let account: AgentSignupAccount;
  try {
    account = await callExternalService<AgentSignupAccount>(
      externalServices.client,
      "/internal/agent-signups/complete",
      { method: "POST", body: { email: body.email, code: body.code } },
    );
  } catch (error) {
    console.error("[agent-signups] complete error:", (error as Error).message);
    return respondUpstreamError(res, error, "Failed to verify the signup code");
  }

  let minted: MintedKey;
  try {
    minted = await callExternalService<MintedKey>(externalServices.key, "/api-keys", {
      method: "POST",
      headers: { "x-org-id": account.orgId, "x-user-id": account.userId },
      body: {
        userId: account.userId,
        createdBy: account.userId,
        name: (keyName as string | undefined)?.trim() || `Agent key ${new Date().toISOString()}`,
      },
    });
  } catch (error) {
    console.error(`[agent-signups] key minting failed for org ${account.orgId}:`, (error as Error).message);
    return res.status(502).json({
      error: "key_minting_failed",
      message:
        "The account is ready but no API key could be created. Call POST /v1/agent-signups/complete again with the same email and code (a code can be redeemed again until it expires).",
      orgId: account.orgId,
      userId: account.userId,
    });
  }

  res.json({
    apiKey: minted.key,
    apiKeyId: minted.id,
    apiKeyName: minted.name,
    orgId: account.orgId,
    userId: account.userId,
    email: account.email,
    contactPhone: account.contactPhone,
    created: account.created,
    usage: "Send it as `Authorization: Bearer <apiKey>` on every call. First call: GET /v1/me. To open a first client (brand, offer, audience, email preview, prepay, campaign), follow GET /v1/me/openapi.json?view=onboarding in order; GET /v1/skills says how to decide each step.",
    prepay: prepayInstructions(),
  });
});

export default router;
