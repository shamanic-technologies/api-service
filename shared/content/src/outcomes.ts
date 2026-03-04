/**
 * Outcome types represent the concrete business results a user wants from a campaign.
 * Workflows are strategies to achieve one or more of these outcomes.
 */
export type OutcomeType =
  | "interested-replies"
  | "link-clicks"
  | "meetings-booked"
  | "press-mentions";

export interface OutcomeDefinition {
  type: OutcomeType;
  label: string;
  description: string;
  icon: string;
}

export const OUTCOME_DEFINITIONS: OutcomeDefinition[] = [
  {
    type: "interested-replies",
    label: "Interested Replies",
    description: "Get replies from prospects who are interested in your offer.",
    icon: "message-circle",
  },
  {
    type: "link-clicks",
    label: "Link Clicks",
    description: "Drive visits to your website, landing page, or booking link.",
    icon: "mouse-pointer-click",
  },
  {
    type: "meetings-booked",
    label: "Meetings Booked",
    description: "Get prospects to book a demo or sales call.",
    icon: "calendar-check",
  },
  {
    type: "press-mentions",
    label: "Press Mentions",
    description: "Get articles published or interviews with journalists.",
    icon: "newspaper",
  },
];

export const OUTCOME_LABELS: Record<OutcomeType, string> = {
  "interested-replies": "Interested Replies",
  "link-clicks": "Link Clicks",
  "meetings-booked": "Meetings Booked",
  "press-mentions": "Press Mentions",
};

export const getOutcomeDefinition = (type: OutcomeType) =>
  OUTCOME_DEFINITIONS.find((o) => o.type === type);
