/**
 * GET /v1/email-sequences — the published (customer) document names every step
 * status instantly-service serves, `bounced` + `bouncedAt` included. A reader
 * trusting a doc that listed only sent|queued|stopped read a refused email as
 * delivered (2026-10-15). Names are the producer's own
 * (instantly-service src/lib/brand-email-sequences.ts).
 */
import { describe, it, expect } from "vitest";
import { buildDocument } from "../../src/openapi/document.js";

type Doc = { paths: Record<string, Record<string, { description?: string; summary?: string }>> };

describe("GET /v1/email-sequences — published step-status doc", () => {
  const op = (buildDocument() as Doc).paths["/v1/email-sequences"].get;

  it("lists bounced among the statuses and documents bouncedAt", () => {
    expect(op.description).toContain("status: sent|bounced|queued|stopped");
    expect(op.description).toContain("`bouncedAt`");
    expect(op.description).toContain("receiving server refused");
    expect(op.summary).toContain("bounced");
  });
});
