import { describe, it, expect } from "vitest";
import {
  OUTCOME_DEFINITIONS,
  OUTCOME_LABELS,
  getOutcomeDefinition,
} from "../src/outcomes.js";

describe("OUTCOME_DEFINITIONS", () => {
  it("has at least 4 outcome definitions", () => {
    expect(OUTCOME_DEFINITIONS.length).toBeGreaterThanOrEqual(4);
  });

  it("each definition has required fields", () => {
    for (const outcome of OUTCOME_DEFINITIONS) {
      expect(outcome.type).toBeTruthy();
      expect(outcome.label).toBeTruthy();
      expect(outcome.description).toBeTruthy();
      expect(outcome.icon).toBeTruthy();
    }
  });

  it("each type has a matching OUTCOME_LABELS entry", () => {
    for (const outcome of OUTCOME_DEFINITIONS) {
      expect(OUTCOME_LABELS[outcome.type]).toBeTruthy();
    }
  });
});

describe("getOutcomeDefinition", () => {
  it("returns definition for known type", () => {
    const outcome = getOutcomeDefinition("interested-replies");
    expect(outcome).toBeDefined();
    expect(outcome!.label).toBe("Interested Replies");
  });

  it("returns undefined for unknown type", () => {
    expect(getOutcomeDefinition("nonexistent" as any)).toBeUndefined();
  });
});

describe("OUTCOME_LABELS", () => {
  it("has labels for all outcome types", () => {
    expect(OUTCOME_LABELS["interested-replies"]).toBe("Interested Replies");
    expect(OUTCOME_LABELS["link-clicks"]).toBe("Link Clicks");
    expect(OUTCOME_LABELS["meetings-booked"]).toBe("Meetings Booked");
    expect(OUTCOME_LABELS["press-mentions"]).toBe("Press Mentions");
  });
});
