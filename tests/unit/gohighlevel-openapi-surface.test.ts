import { describe, it, expect } from "vitest";
import { buildDocument } from "../../src/openapi/document.js";

/**
 * The published document is the customer's document. The GoHighLevel + brand-key
 * surface belongs on it (a customer calls every one of these with their own key),
 * and the credential-resolving decrypt route must appear on NEITHER document —
 * it is not proxied at all.
 */
describe("gohighlevel + brand-key published surface", () => {
  const publicDoc = buildDocument() as { paths: Record<string, Record<string, unknown>> };
  const staffDoc = buildDocument({ audience: "staff" }) as {
    paths: Record<string, Record<string, unknown>>;
  };

  const EXPECTED: Array<[string, string]> = [
    ["get", "/v1/keys/brands/{brandId}"],
    ["post", "/v1/keys/brands/{brandId}"],
    ["delete", "/v1/keys/brands/{brandId}/{provider}"],
    ["post", "/v1/orgs/gohighlevel/connections"],
    ["get", "/v1/orgs/gohighlevel/connections"],
    ["patch", "/v1/orgs/gohighlevel/connections/{id}"],
    ["delete", "/v1/orgs/gohighlevel/connections/{id}"],
    ["get", "/v1/orgs/gohighlevel/contacts"],
    ["get", "/v1/orgs/gohighlevel/opportunities"],
  ];

  it("publishes every new operation to the customer document", () => {
    for (const [method, path] of EXPECTED) {
      expect(publicDoc.paths[path], path).toBeDefined();
      expect(publicDoc.paths[path][method], `${method} ${path}`).toBeDefined();
    }
  });

  it("documents no decrypt route on either document", () => {
    for (const doc of [publicDoc, staffDoc]) {
      const decryptPaths = Object.keys(doc.paths).filter((p) => p.includes("decrypt"));
      expect(decryptPaths).toEqual([]);
    }
  });

  it("documents no gohighlevel /internal path", () => {
    for (const doc of [publicDoc, staffDoc]) {
      const internal = Object.keys(doc.paths).filter((p) => p.includes("gohighlevel/sync") || p.includes("gohighlevel/rebuild"));
      expect(internal).toEqual([]);
    }
  });
});
