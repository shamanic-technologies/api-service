import { AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "./service-client.js";
import { buildInternalHeaders } from "./internal-headers.js";

interface RepliesDetail {
  interested: number; meetingBooked: number; closed: number;
  notInterested: number; wrongPerson: number; unsubscribe: number;
  neutral: number; autoReply: number; outOfOffice: number;
}

interface EmailGatewayStats {
  emailsContacted: number; emailsSent: number; emailsDelivered: number; emailsOpened: number;
  emailsClicked: number; emailsBounced: number;
  repliesPositive: number; repliesNegative: number; repliesNeutral: number; repliesAutoReply: number;
  repliesDetail: RepliesDetail;
  recipients: number;
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
    repliesPositive: b.repliesPositive || 0,
    repliesNegative: b.repliesNegative || 0,
    repliesNeutral: b.repliesNeutral || 0,
    repliesAutoReply: b.repliesAutoReply || 0,
    repliesDetail: b.repliesDetail ?? {
      interested: 0, meetingBooked: 0, closed: 0,
      notInterested: 0, wrongPerson: 0, unsubscribe: 0,
      neutral: 0, autoReply: 0, outOfOffice: 0,
    },
  };
}
