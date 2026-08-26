import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The manual-qualification routes are transparent proxies: the handler forwards
 * `req.body` and parses nothing. So the OpenAPI schema is a DESCRIPTION of a
 * passthrough, never its contract — and a closed enum there is worse than saying
 * nothing, because a reader wiring a consumer takes it as the accepted set.
 *
 * It had gone stale exactly that way: instantly-service moved the two deal-progress
 * values out to the lead-outcomes service and split the positive case four ways, so
 * the documented 8 named three values that no longer mean what they said and omitted
 * four that work today. Nothing broke on the wire; the doc simply lied.
 */
const openapi = JSON.parse(readFileSync(join(__dirname, "../../openapi.json"), "utf8"));
const routes = readFileSync(join(__dirname, "../../src/routes/emails.ts"), "utf8");

describe("manual qualifications stay a passthrough", () => {
  it("documents no closed status vocabulary", () => {
    const schema = openapi.components.schemas.ManualQualificationCreateRequest;
    expect(JSON.stringify(schema)).not.toContain("enum");
    expect(schema.properties.status.type).toBe("string");
  });

  it("names instantly-service as the owner of that vocabulary", () => {
    const desc = openapi.components.schemas.ManualQualificationCreateRequest.properties.status.description;
    expect(desc).toContain("instantly-service");
  });

  it("forwards the body without parsing it", () => {
    const slice = routes.slice(routes.indexOf('"/emails/manual-qualifications"'));
    expect(slice).toContain("body: req.body");
    expect(slice.slice(0, 900)).not.toContain("safeParse");
  });

  it("forwards a refusal with its own status and body", () => {
    // Rebuilding the envelope from the thrown Error stringifies the WHOLE downstream
    // body into `error`, destroying the code a consumer branches on.
    const slice = routes.slice(routes.indexOf('"/emails/manual-qualifications"'));
    expect(slice).toContain('respondUpstreamError(res, error, "Failed to record manual qualification")');
    expect(slice).not.toContain('error: error.message || "Failed to record manual qualification"');
  });
});
