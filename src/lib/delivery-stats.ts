import { AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "./service-client.js";
import { buildInternalHeaders } from "./internal-headers.js";

interface RepliesDetail {
  interested: number; meetingBooked: number; closed: number;
  notInterested: number; wrongPerson: number; unsubscribe: number;
  neutral: number; autoReply: number; outOfOffice: number;
}

interface RecipientStats {
  contacted: number; sent: number; delivered: number; opened: number;
  bounced: number; clicked: number; unsubscribed: number;
  repliesPositive: number; repliesNegative: number; repliesNeutral: number; repliesAutoReply: number;
  repliesDetail: RepliesDetail;
}

interface EmailStats {
  sent: number; delivered: number; opened: number; clicked: number;
  bounced: number; unsubscribed: number;
  stepStats: unknown[];
}

export interface DeliveryStats {
  recipientStats: RecipientStats;
  emailStats: EmailStats;
}

const EMPTY_REPLIES_DETAIL: RepliesDetail = {
  interested: 0, meetingBooked: 0, closed: 0,
  notInterested: 0, wrongPerson: 0, unsubscribe: 0,
  neutral: 0, autoReply: 0, outOfOffice: 0,
};

export const EMPTY_DELIVERY_STATS: DeliveryStats = {
  recipientStats: {
    contacted: 0, sent: 0, delivered: 0, opened: 0,
    bounced: 0, clicked: 0, unsubscribed: 0,
    repliesPositive: 0, repliesNegative: 0, repliesNeutral: 0, repliesAutoReply: 0,
    repliesDetail: EMPTY_REPLIES_DETAIL,
  },
  emailStats: {
    sent: 0, delivered: 0, opened: 0, clicked: 0,
    bounced: 0, unsubscribed: 0,
    stepStats: [],
  },
};

/** Fetch delivery stats from email-gateway (broadcast only). */
export async function fetchDeliveryStats(
  filters: { campaignId?: string; brandId?: string; workflowSlugs?: string; featureSlugs?: string; workflowDynastySlug?: string; featureDynastySlug?: string },
  req: AuthenticatedRequest,
): Promise<DeliveryStats | null> {
  const orgId = req.orgId!;
  const params = new URLSearchParams({ orgId });
  for (const key of ["campaignId", "brandId", "workflowSlugs", "featureSlugs", "workflowDynastySlug", "featureDynastySlug"] as const) {
    if (filters[key]) params.set(key, filters[key]!);
  }
  const result = await callExternalService<{ transactional: unknown; broadcast: { recipientStats: RecipientStats; emailStats: EmailStats } | null }>(
    externalServices.emailGateway,
    `/orgs/stats?${params}`,
    {
      headers: buildInternalHeaders(req),
    }
  ).catch((err) => {
    console.error("[delivery-stats] Email-gateway stats failed:", (err as Error).message);
    return null;
  });

  const b = (result as any)?.broadcast;
  if (!b) return null;

  return {
    recipientStats: b.recipientStats ?? EMPTY_DELIVERY_STATS.recipientStats,
    emailStats: b.emailStats ?? EMPTY_DELIVERY_STATS.emailStats,
  };
}
