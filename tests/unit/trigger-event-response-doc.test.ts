import { describe, it, expect } from "vitest";
import { buildDocument } from "../../src/openapi/document.js";

type Json = Record<string, any>;

/**
 * POST /v1/trigger-events answers campaign-service's `{event, replayed}`. The customer document must say so,
 * so an agent can read what the push did (`event.outcome`, `skipReason`, `ranCampaignIds`): it was `{}` (owner
 * gap 2026-10-14). The route pipes the bytes, so these fields document and validate nothing.
 */
describe("POST /v1/trigger-events documents the event it answers", () => {
  const doc = buildDocument();
  const schemas = doc.components.schemas as Json;
  const resolve = (s: Json): Json => (s.$ref ? schemas[s.$ref.split("/").pop()] : s);

  for (const status of ["201", "200"]) {
    it(`${status} carries event + replayed`, () => {
      const body = resolve(doc.paths["/v1/trigger-events"].post.responses[status].content["application/json"].schema);
      expect(Object.keys(body.properties)).toEqual(["event", "replayed"]);
      const event = resolve(body.properties.event);
      for (const f of ["id", "triggerId", "leadId", "status", "outcome", "skipReason", "ranCampaignIds", "ranLeads", "processedAt", "detail"]) {
        expect(event.properties, f).toHaveProperty(f);
      }
    });
  }

  it("the offer's event list carries the same event", () => {
    const body = resolve(doc.paths["/v1/offers/{offerId}/trigger-events"].get.responses["200"].content["application/json"].schema);
    expect(resolve(body.properties.events.items).properties).toHaveProperty("outcome");
  });
});
