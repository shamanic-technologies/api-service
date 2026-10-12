import { describe, it, expect } from "vitest";
import { buildDocument, STAFF_KEY_OPERATIONS, STAFF_KEY_TAG } from "../../src/openapi/document.js";
import {
  DOWNSTREAM_BODY_SNAPSHOT,
  DOWNSTREAM_BODY_SOURCES,
  attachDownstreamBodies,
  isEmptyBodySchema,
} from "../../src/openapi/downstream-bodies.js";

type Json = Record<string, any>;
const WRITES = ["post", "put", "patch"] as const;

function writes(doc: Json): Array<{ key: string; op: Json }> {
  const out: Array<{ key: string; op: Json }> = [];
  for (const [path, item] of Object.entries(doc.paths as Json)) {
    for (const m of WRITES) if ((item as Json)[m]) out.push({ key: `${m.toUpperCase()} ${path}`, op: (item as Json)[m] });
  }
  return out;
}

describe("request bodies of proxied writes are described (owner gap 2026-10-12)", () => {
  const publicDoc = buildDocument();

  it("every customer write that takes a JSON body says which fields to send", () => {
    const empty = writes(publicDoc)
      .filter(({ op }) => op.requestBody?.content?.["application/json"])
      .filter(({ key, op }) => isEmptyBodySchema(publicDoc, op.requestBody.content["application/json"].schema))
      // The producer itself documents no body for these: nothing to describe.
      .filter(({ key }) => !(key in DOWNSTREAM_BODY_SNAPSHOT && DOWNSTREAM_BODY_SNAPSHOT[key].schema === null))
      .map(({ key }) => key);
    expect(empty, "add the producer route to DOWNSTREAM_BODY_SOURCES and run scripts/sync-downstream-bodies.ts").toEqual([]);
  });

  it("the documented bodies the MCP had to guess now carry their fields", () => {
    const props = (key: string) => {
      const [method, path] = key.split(" ");
      return Object.keys(publicDoc.paths[path][method.toLowerCase()].requestBody.content["application/json"].schema.properties ?? {});
    };
    expect(props("POST /v1/brands/{id}/offers/proposals").length).toBeGreaterThan(0);
    expect(props("POST /v1/brands/{id}/offers/confirm").length).toBeGreaterThan(0);
    expect(props("POST /v1/orgs/audiences/portfolio").length).toBeGreaterThan(0);
    expect(props("POST /v1/sales-funnel-campaigns").length).toBeGreaterThan(0);
    expect(props("PUT /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps").length).toBeGreaterThan(0);
    expect(props("POST /v1/replies")).toEqual(expect.arrayContaining(["email", "body_html"]));
  });

  it("every mapped write exists in the gateway and has a snapshot", () => {
    const staffDoc = buildDocument({ audience: "staff" });
    const keys = new Set(writes(staffDoc).map((w) => w.key));
    for (const key of Object.keys(DOWNSTREAM_BODY_SOURCES)) {
      expect(keys.has(key), `${key} is mapped but not registered`).toBe(true);
      expect(DOWNSTREAM_BODY_SNAPSHOT[key], `${key} has no snapshot: run scripts/sync-downstream-bodies.ts`).toBeDefined();
    }
  });

  it("a gateway schema that declares fields wins over the snapshot", () => {
    const doc: Json = {
      paths: { "/x": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { own: { type: "string" } } } } } } } } },
    };
    attachDownstreamBodies(doc, { "POST /x": { service: "s", method: "POST", path: "/x", schema: { type: "object", properties: { theirs: {} } } } });
    expect(Object.keys(doc.paths["/x"].post.requestBody.content["application/json"].schema.properties)).toEqual(["own"]);
  });
});

describe("staff-key audience (GET /v1/me/openapi.json for a staff member's key)", () => {
  const publicDoc = buildDocument();
  const staffKeyDoc = buildDocument({ audience: "staff-key" });
  const ops = (doc: Json) => new Set(writes(doc).map((w) => w.key).concat(
    Object.entries(doc.paths as Json).flatMap(([p, item]) => ["get", "delete"].filter((m) => (item as Json)[m]).map((m) => `${m.toUpperCase()} ${p}`)),
  ));

  it("is the public document plus exactly the staff-key operations", () => {
    const pub = ops(publicDoc);
    const staff = ops(staffKeyDoc);
    for (const k of pub) expect(staff.has(k), k).toBe(true);
    const extra = [...staff].filter((k) => !pub.has(k)).sort();
    expect(extra).toEqual([...STAFF_KEY_OPERATIONS].sort());
  });

  it("marks each staff-key operation x-staff-only, tagged, Bearer only", () => {
    for (const key of STAFF_KEY_OPERATIONS) {
      const [method, path] = key.split(" ");
      const op = (staffKeyDoc.paths as Json)[path][method.toLowerCase()];
      expect(op["x-staff-only"]).toBe(true);
      expect(op.tags).toEqual([STAFF_KEY_TAG]);
      expect(op.security).toEqual([{ bearerAuth: [] }]);
    }
  });

  it("the public document never carries a staff-key operation", () => {
    for (const key of STAFF_KEY_OPERATIONS) {
      const [method, path] = key.split(" ");
      expect((publicDoc.paths as Json)[path]?.[method.toLowerCase()]).toBeUndefined();
    }
  });
});
