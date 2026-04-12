import { AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "./service-client.js";
import { buildInternalHeaders } from "./internal-headers.js";

interface EmailGatewayStats {
  emailsContacted: number; emailsSent: number; emailsDelivered: number; emailsOpened: number;
  emailsClicked: number; emailsBounced: number;
  repliesInterested: number; repliesMeetingBooked: number; repliesClosed: number;
  repliesNotInterested: number; repliesNeutral: number; repliesOutOfOffice: number;
  repliesUnsubscribe: number; recipients: number;
}

/** Fetch delivery stats from email-gateway (aggregates transactional + broadcast). */
export async function fetchDeliveryStats(
  filters: { campaignId?: string; brandId?: string; workflowSlugs?: string; featureSlugs?: string; workflowDynastySlug?: string; featureDynastySlug?: string },
  req: AuthenticatedRequest,
): Promise<Record<string, number> | null> {
  const orgId = req.orgId!;
  const params = new URLSearchParams({ orgId });
  for (const key of ["campaignId", "brandId", "workflowSlugs", "featureSlugs", "workflowDynastySlug", "featureDynastySlug"] as const) {
    if (filters[key]) params.set(key, filters[key]!);
  }
  const deliveryResult = await callExternalService<{ transactional: EmailGatewayStats; broadcast: EmailGatewayStats }>(
    externalServices.emailGateway,
    `/orgs/stats?${params}`,
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
    emailsBounced: b.emailsBounced || 0,
    repliesInterested: b.repliesInterested || 0,
    repliesMeetingBooked: b.repliesMeetingBooked || 0,
    repliesClosed: b.repliesClosed || 0,
    repliesNotInterested: b.repliesNotInterested || 0,
    repliesNeutral: b.repliesNeutral || 0,
    repliesOutOfOffice: b.repliesOutOfOffice || 0,
    repliesUnsubscribe: b.repliesUnsubscribe || 0,
  };
}
