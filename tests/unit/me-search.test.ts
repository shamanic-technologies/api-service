import { describe, it, expect } from "vitest";
import { filterOrganizations } from "../../src/routes/me.js";

const ORGS = [
  { id: "7dacdda1-b719-45ea-9bfe-94cb46d0967d", name: "Leading Is Learning", brands: [{ id: "b1", name: "LIL", domain: "leadingislearning.co" }, { id: "b2", name: "Other", domain: "other.io" }] },
  { id: "org-2", name: "Acme", brands: [{ id: "b3", name: "Acme Main", domain: "acme.com" }, { id: "b4", name: "Side", domain: "leadingislearning-side.co" }] },
  { id: "org-3", name: null, brands: [] },
];

describe("GET /v1/me ?q= (find one org or brand)", () => {
  it("an org matched by name keeps all its brands", () => {
    expect(filterOrganizations(ORGS, "leading is")).toEqual([ORGS[0]]);
  });
  it("an org matched only through a brand lists only that brand", () => {
    const out = filterOrganizations(ORGS, "LEADINGISLEARNING");
    expect(out.map((o) => o.id)).toEqual([ORGS[0].id, "org-2"]);
    expect(out[0].brands.map((b) => b.id)).toEqual(["b1"]); // name has spaces: matched via the brand domain only
    expect(out[1].brands.map((b) => b.id)).toEqual(["b4"]);
  });
  it("matches an org id prefix", () => {
    expect(filterOrganizations(ORGS, "7dacdda1").map((o) => o.id)).toEqual([ORGS[0].id]);
  });
  it("no match is an empty list, never the unfiltered one", () => {
    expect(filterOrganizations(ORGS, "nothing-like-this")).toEqual([]);
  });
});
