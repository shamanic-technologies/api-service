import { AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "./service-client.js";
import { buildInternalHeaders } from "./internal-headers.js";

interface EmailGatewayStats {
  emailsContacted: number; emailsSent: number; emailsDelivered: number; emailsOpened: number;
  emailsClicked: number; emailsReplied: number; emailsBounced: number;
  repliesWillingToMeet: number; repliesInterested: number; repliesNotInterested: number;
  repliesOutOfOffice: number; repliesUnsubscribe: number; recipients: number;
}

/** Fetch delivery stats from email-gateway (aggregates transactional + broadcast). */
export async function fetchDeliveryStats(
  filters: { campaignId?: string; brandId?: string },
  req: AuthenticatedRequest,
): Promise<Record<string, number> | null> {
  const orgId = req.orgId!;
  const params = new URLSearchParams({ orgId });
  if (filters.campaignId) params.set("campaignId", filters.campaignId);
  if (filters.brandId) params.set("brandId", filters.brandId);
  const deliveryResult = await callExternalService<{ transactional: EmailGatewayStats; broadcast: EmailGatewayStats }>(
    externalServices.emailGateway,
    `/stats?${params}`,
    {
      headers: buildInternalHeaders(req),
    }
  ).catch((err) => {
    console.warn("[delivery-stats] Email-gateway stats failed:", (err as Error).message);
    return null;
  });

  // Only use broadcast stats (outreach emails via Instantly).
  // Transactional stats are transactional/test emails via Postmark — not relevant.
  const b = (deliveryResult as any)?.broadcast;
  if (!b) return null;

  return {
    emailsContacted: b.emailsContacted || 0,
    emailsSent: b.emailsSent || 0,
    emailsDelivered: b.emailsDelivered || 0,
    emailsOpened: b.emailsOpened || 0,
    emailsClicked: b.emailsClicked || 0,
    emailsReplied: b.emailsReplied || 0,
    emailsBounced: b.emailsBounced || 0,
    repliesWillingToMeet: b.repliesWillingToMeet || 0,
    repliesInterested: b.repliesInterested || 0,
    repliesNotInterested: b.repliesNotInterested || 0,
    repliesOutOfOffice: b.repliesOutOfOffice || 0,
    repliesUnsubscribe: b.repliesUnsubscribe || 0,
    leadsContacted: b.recipients || 0,
  };
}
