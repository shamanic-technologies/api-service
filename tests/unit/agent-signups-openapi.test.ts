import { describe, it, expect } from "vitest";
import { buildDocument } from "../../src/openapi/document.js";
import { DOWNSTREAM_BODY_SOURCES, attachDownstreamBodies } from "../../src/openapi/downstream-bodies.js";
import { AGENT_SIGNUP_COMPLETE_FIELDS, AGENT_SIGNUP_START_FIELDS } from "../../src/lib/agent-signup-fields.js";

type Json = Record<string, any>;

/**
 * The keyless agent signup forwards an allowlist (security hotfix DISTRY-ONE-AI-1118), so its
 * published body must describe that allowlist and nothing else: a field the document names but the
 * gateway drops is a lie to an agent, and an internal-only field of client-service must not be
 * advertised on a route that needs no key.
 */
function bodyOf(doc: Json, path: string): Json {
  let schema = doc.paths[path].post.requestBody.content["application/json"].schema as Json;
  if (typeof schema.$ref === "string") schema = doc.components.schemas[schema.$ref.split("/").pop()!];
  return schema;
}

describe("published body of the public agent signup", () => {
  const doc = buildDocument() as Json;

  it("the allowlists are the email and its proof, plus the unverified contact phone on start", () => {
    expect([...AGENT_SIGNUP_START_FIELDS]).toEqual(["email", "phone"]);
    expect([...AGENT_SIGNUP_COMPLETE_FIELDS]).toEqual(["email", "code", "pollToken"]);
  });

  it("start describes exactly the fields the gateway forwards", () => {
    const body = bodyOf(doc, "/v1/agent-signups/start");
    expect(Object.keys(body.properties).sort()).toEqual([...AGENT_SIGNUP_START_FIELDS].sort());
    expect(body.required).toEqual(["email"]);
  });

  it("complete describes exactly the forwarded fields plus the gateway's own keyName", () => {
    const body = bodyOf(doc, "/v1/agent-signups/complete");
    expect(Object.keys(body.properties).sort()).toEqual([...AGENT_SIGNUP_COMPLETE_FIELDS, "keyName"].sort());
  });

  it("neither operation claims the REQUEST body is forwarded unchanged, and both say other fields are ignored", () => {
    for (const path of ["/v1/agent-signups/start", "/v1/agent-signups/complete"]) {
      const description = doc.paths[path].post.description as string;
      // Scoped to the request-body sentence: the answer IS forwarded unchanged, and its own note says so.
      expect(description, path).not.toMatch(/Request body:[^\n]*forwards it unchanged/);
      expect(description, path).toMatch(/any other field is ignored/i);
    }
  });

  it("start is mapped with its allowlist, so a re-sync cannot publish a field the gateway drops", () => {
    expect(DOWNSTREAM_BODY_SOURCES["POST /v1/agent-signups/start"].only).toEqual([...AGENT_SIGNUP_START_FIELDS]);
  });
});

describe("attachDownstreamBodies with an `only` allowlist", () => {
  const producerBody = () => ({
    type: "object",
    properties: { email: { type: "string" }, phone: { type: "string" }, trustedChannelPhone: { type: "string" } },
    required: ["email", "trustedChannelPhone"],
  });
  const emptyOp = (): Json => ({ paths: { "/x": { post: { description: "Does x.", requestBody: { content: { "application/json": { schema: {} } } } } } } });

  it("publishes only the allowed fields of the producer's body, required list included", () => {
    const doc = emptyOp();
    attachDownstreamBodies(doc, { "POST /x": { service: "s", method: "POST", path: "/x", only: ["email", "phone"], schema: producerBody() } });
    const schema = doc.paths["/x"].post.requestBody.content["application/json"].schema;
    expect(Object.keys(schema.properties)).toEqual(["email", "phone"]);
    expect(schema.required).toEqual(["email"]);
    expect(JSON.stringify(doc)).not.toContain("trustedChannelPhone");
    expect(doc.paths["/x"].post.description).toContain("forwards only `email`, `phone`");
    expect(doc.paths["/x"].post.description).not.toContain("forwards it unchanged");
  });

  it("leaves the shared snapshot untouched (a second build sees the same producer body)", () => {
    const snapshot = { "POST /x": { service: "s", method: "POST" as const, path: "/x", only: ["email"], schema: producerBody() } };
    attachDownstreamBodies(emptyOp(), snapshot);
    expect(Object.keys(snapshot["POST /x"].schema.properties)).toEqual(["email", "phone", "trustedChannelPhone"]);
    expect(snapshot["POST /x"].schema.required).toEqual(["email", "trustedChannelPhone"]);
  });

  it("filters every branch of a union body, so a producer that turns its body into a union publishes nothing more", () => {
    const doc = emptyOp();
    const union = { anyOf: [producerBody(), { type: "object", properties: { email: { type: "string" }, staffOnlyToken: { type: "string" } }, required: ["staffOnlyToken"] }] };
    attachDownstreamBodies(doc, { "POST /x": { service: "s", method: "POST", path: "/x", only: ["email", "phone"], schema: union } });
    const branches = doc.paths["/x"].post.requestBody.content["application/json"].schema.anyOf;
    expect(branches.map((b: Json) => Object.keys(b.properties))).toEqual([["email", "phone"], ["email"]]);
    expect(branches.map((b: Json) => b.required)).toEqual([["email"], []]);
    expect(JSON.stringify(doc)).not.toMatch(/trustedChannelPhone|staffOnlyToken/);
  });

  it("without `only`, the producer's body is published whole, as before", () => {
    const doc = emptyOp();
    attachDownstreamBodies(doc, { "POST /x": { service: "s", method: "POST", path: "/x", schema: producerBody() } });
    expect(Object.keys(doc.paths["/x"].post.requestBody.content["application/json"].schema.properties)).toEqual(["email", "phone", "trustedChannelPhone"]);
    expect(doc.paths["/x"].post.description).toContain("the gateway forwards it unchanged");
  });
});
