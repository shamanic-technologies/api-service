import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { runWithUpstreamPaymentState, upstreamPaymentRequiredBody } from "../lib/upstream-payment.js";
import { PREPAID_CHECKOUT_PATH, prepayInstructions } from "../lib/agent-prepay.js";

/** billing-service's mark on an org opened through the API: no free credit, prepaid only. */
export const AGENT_API_OFFER = "agent_api";

interface PrepaidStatus {
  state?: string;
  free_credit_offer?: string;
  balance_cents?: string;
  card?: { not_reloadable_reason?: string | null };
}

/**
 * "Payment required" answer for organizations opened by an AI agent.
 *
 * Owner 2026-10-12: an agent uses every free endpoint, and "if an endpoint
 * requires money then we would send them a way to prepay". Downstream services
 * already refuse a call the org cannot pay for (402), but each in its own shape,
 * and many route catches here re-emit it as a 500. For a key-authenticated call
 * on an org billing marks `agent_api`, this turns that refusal into one legible
 * 402: what happened, the balance, and the exact prepay route with its minimums.
 * The downstream's own body stays under `upstream`.
 *
 * Fires only when the response is an error AND (it is a 402, or a downstream
 * answered 402 while serving it and the route answered 5xx). Every other org, and
 * every platform-key (dashboard) call, gets the response it got before.
 */
export function agentPaymentRequired(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  runWithUpstreamPaymentState(() => {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const upstream = upstreamPaymentRequiredBody();
      const paymentFailure =
        res.statusCode === 402 || (upstream !== undefined && res.statusCode >= 500);
      if (!paymentFailure || req.authType !== "user_key" || !req.orgId || res.headersSent) {
        return originalJson(body);
      }
      void answerForAgentOrg(req, res, originalJson, body, upstream);
      return res;
    }) as Response["json"];
    next();
  });
}

async function answerForAgentOrg(
  req: AuthenticatedRequest,
  res: Response,
  send: (body: unknown) => Response,
  body: unknown,
  upstream: string | undefined,
): Promise<void> {
  let status: PrepaidStatus;
  try {
    const headers: Record<string, string> = { "x-org-id": req.orgId! };
    if (req.userId) headers["x-user-id"] = req.userId;
    if (req.runId) headers["x-run-id"] = req.runId;
    status = await callExternalService<PrepaidStatus>(externalServices.billing, "/v1/accounts/prepaid_status", {
      headers,
    });
  } catch (error) {
    // The org's offer could not be read: answer exactly what the route answered.
    console.error(
      `[payment-required] prepaid status unreadable for org ${req.orgId}, answering the route's own ${res.statusCode}:`,
      (error as Error).message,
    );
    send(body);
    return;
  }

  if (status.free_credit_offer !== AGENT_API_OFFER) {
    send(body);
    return;
  }

  res.status(402);
  res.setHeader("Link", `<${PREPAID_CHECKOUT_PATH}>; rel="payment"`);
  send({
    error: "payment_required",
    code: "payment_required",
    message: messageFor(status),
    balance_cents: status.balance_cents ?? null,
    prepaid_state: status.state ?? null,
    prepay: prepayInstructions(),
    upstream: upstream !== undefined ? parseOrRaw(upstream) : body,
  });
}

function messageFor(status: PrepaidStatus): string {
  const how =
    `Prepay with POST ${PREPAID_CHECKOUT_PATH} (topup_amount_cents >= 1000 = $10, ` +
    "auto_topup_amount_cents >= 1500 = $15, auto_topup_threshold_cents >= 500 = $5). " +
    "It returns a payment `url`: open it, or give it to your human to pay by card. Then retry this call.";
  switch (status.state) {
    case "card_not_reloadable":
      return (
        "This call costs money and the balance cannot cover it. The saved card cannot be charged automatically " +
        `(${status.card?.not_reloadable_reason ?? "unknown reason"}), so no reload happened. Pay with another card. ${how}`
      );
    case "active":
      return `This call costs money and the balance cannot cover it, even after the automatic reload. Add funds. ${how}`;
    default:
      return `This call costs money and this organization has no prepaid balance. There is no free credit. ${how}`;
  }
}

function parseOrRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Not JSON (an HTML page, plain text): the raw text is the upstream body.
    return raw;
  }
}
