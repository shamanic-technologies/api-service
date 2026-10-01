/**
 * Success-first framing for the campaign stats this gateway assembles.
 *
 * Owner rule: anything a human or an agent reads leads with the king metrics
 * (meetings and positive replies, money earned / ROI when known, delivery rate),
 * then volume and cost; failure counts (bounces, unsubscribes, negative replies)
 * go last. LLM readers weigh the first keys of a JSON object most, so `headline`
 * is placed FIRST and `failureDetails` LAST in the response; every pre-existing
 * field stays where it was between them.
 *
 * Nothing here computes a metric: each value is a figure a producer already
 * served (email-gateway recipient stats including its deliveryRate, the cost the route already returns),
 * copied under a success-first name. What no producer serves is `null` and
 * named in `notServed` with the service that would have to serve it, so a
 * reader sees the gap instead of a silent omission. A `null` count means the
 * producer could not be reached (`unavailable` names it), never "zero".
 */

interface RecipientLike {
  sent: number;
  delivered: number;
  bounced: number;
  unsubscribed: number;
  repliesPositive: number;
  repliesNegative: number;
  /** delivered/sent ratio (0..1) served by email-gateway; null when sent=0 or delivered>sent. */
  deliveryRate?: number | null;
  repliesDetail?: Record<string, number> | { meetingBooked?: number };
}

export const NOT_SERVED = [
  "moneyEarnedInUsdCents / roi: no service serves realized money earned per campaign; features-service serves EXPECTED pipeline revenue per campaign at GET /v1/features/{slug}/revenue?groupBy=campaign",
];

export function buildHeadline(
  recipient: RecipientLike | null,
  costInUsdCents: string | null,
) {
  const unavailable = recipient ? [] : ["email-gateway"];
  const detail = (recipient?.repliesDetail ?? {}) as { meetingBooked?: number };
  return {
    meetingsBooked: recipient ? detail.meetingBooked ?? null : null,
    positiveReplies: recipient ? recipient.repliesPositive : null,
    moneyEarnedInUsdCents: null,
    roi: null,
    // email-gateway's own ratio, copied. A campaign with no email-gateway group
    // carries the empty default (sent=0), for which the producer also says null.
    deliveryRate: recipient ? recipient.deliveryRate ?? null : null,
    delivered: recipient ? recipient.delivered : null,
    sent: recipient ? recipient.sent : null,
    costInUsdCents,
    notServed: NOT_SERVED,
    unavailable,
  };
}

export function buildFailureDetails(recipient: RecipientLike | null) {
  return {
    bounced: recipient ? recipient.bounced : null,
    unsubscribed: recipient ? recipient.unsubscribed : null,
    negativeReplies: recipient ? recipient.repliesNegative : null,
  };
}
