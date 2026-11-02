import { describe, it, expect } from "vitest";
import { buildDocument, HTTP_METHODS } from "../../src/openapi/document.js";
import { selectDocument } from "../../src/openapi/views.js";
import { USER_YES_DECISIONS, USER_YES_EXTENSION } from "../../src/openapi/user-yes.js";

/**
 * SOPHIE-YES-GATE-1102: the served document says, per operation, whether the
 * caller must get its user's explicit yes first (spends money, starts work,
 * sends something to a person). Consumers (chat-service, the MCP, outside
 * agents) read the marker; no consumer keeps a list of operation ids.
 */

type Op = Record<string, any>;

function operations(doc: Record<string, any>): Array<{ key: string; method: string; op: Op }> {
  const out: Array<{ key: string; method: string; op: Op }> = [];
  for (const [path, item] of Object.entries<Record<string, Op>>(doc.paths)) {
    for (const method of HTTP_METHODS) {
      if (item[method]) out.push({ key: `${method.toUpperCase()} ${path}`, method, op: item[method] });
    }
  }
  return out;
}

const staff = buildDocument({ audience: "staff" });
const pub = buildDocument({ audience: "public" });
const staffKey = buildDocument({ audience: "staff-key" });

describe("x-needs-user-yes: every write operation carries a decision", () => {
  it("every non-GET operation of the complete document is decided in USER_YES_DECISIONS (marked or NO)", () => {
    const undecided = operations(staff)
      .filter(({ method }) => method !== "get")
      .map(({ key }) => key)
      .filter((key) => !(key in USER_YES_DECISIONS));
    // A new write operation needs a decision: add it to src/openapi/user-yes.ts,
    // `yes([...], why)` if it spends money, starts work or sends to a person, else NO.
    expect(undecided).toEqual([]);
  });

  it("no decision names an operation that no longer exists, nor a GET", () => {
    const existing = new Set(operations(staff).filter(({ method }) => method !== "get").map(({ key }) => key));
    const stale = Object.keys(USER_YES_DECISIONS).filter((key) => !existing.has(key));
    expect(stale).toEqual([]);
  });
});

describe("x-needs-user-yes: what the served documents carry", () => {
  for (const [name, doc] of [
    ["public", pub],
    ["staff-key", staffKey],
    ["staff", staff],
  ] as const) {
    it(`${name}: no read operation is marked`, () => {
      const markedReads = operations(doc)
        .filter(({ method, op }) => method === "get" && op[USER_YES_EXTENSION])
        .map(({ key }) => key);
      expect(markedReads).toEqual([]);
    });

    it(`${name}: every marked operation states its reasons and a why`, () => {
      for (const { op } of operations(doc).filter(({ op }) => op[USER_YES_EXTENSION])) {
        const marker = op[USER_YES_EXTENSION];
        expect(marker.because.length).toBeGreaterThan(0);
        for (const reason of marker.because) {
          expect(["spends_money", "starts_work", "sends_to_person"]).toContain(reason);
        }
        expect(marker.why.length).toBeGreaterThan(10);
      }
    });
  }

  it("public: the consumer's reference operations are marked", () => {
    const marked = (key: string) => {
      const [method, path] = key.split(" ");
      return pub.paths[path]?.[method.toLowerCase()]?.[USER_YES_EXTENSION];
    };
    // Starting a sales funnel campaign (created or set running)
    expect(marked("POST /v1/sales-funnel-campaigns")?.because).toContain("starts_work");
    expect(marked("POST /v1/sales-funnel-campaigns")?.notNeededWhen).toEqual([{ status: "stopped" }]);
    expect(marked("PATCH /v1/sales-funnel-campaigns/{id}")?.because).toContain("starts_work");
    // Changing its caps
    expect(marked("PUT /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps")?.because).toContain(
      "spends_money",
    );
    // Pushing an email through trigger events
    expect(marked("POST /v1/trigger-events")?.because).toContain("sends_to_person");
    // Opening a prepaid checkout
    expect(marked("POST /v1/billing/accounts/prepaid_checkout")?.because).toContain("spends_money");
    // Harmless writes stay unmarked
    expect(marked("PATCH /v1/orgs/audiences/{id}")).toBeUndefined();
    expect(marked("POST /v1/brands")).toBeUndefined();
    expect(marked("POST /v1/campaigns/{id}/stop")).toBeUndefined();
  });

  it("the document's own description tells an outside AI to ask its user first, and the root states the policy", () => {
    const description = (pub.info as { description: string }).description;
    expect(description).toContain(USER_YES_EXTENSION);
    expect(description).toMatch(/explicit yes/);
    expect((pub as Record<string, any>)[USER_YES_EXTENSION].reasons).toHaveProperty("sends_to_person");
  });

  it("?view=index flags the marked operations", () => {
    const index = selectDocument(pub as Record<string, any>, { kind: "index" }) as Record<string, any>;
    const text = JSON.stringify(index);
    expect(text).toMatch(/postV1BillingAccountsPrepaidCheckout` POST \/v1\/billing\/accounts\/prepaid_checkout: [^\\]*\[ASK YOUR USER FIRST\]/);
    expect(text).not.toMatch(/getV1Me` GET \/v1\/me: [^\\]*\[ASK YOUR USER FIRST\]/);
  });
});
