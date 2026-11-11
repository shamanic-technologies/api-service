import { describe, it, expect } from "vitest";
import { buildDocument, HTTP_METHODS } from "../../src/openapi/document.js";
import { selectDocument } from "../../src/openapi/views.js";
import { USER_YES_DECISIONS, USER_YES_EXTENSION, needsUserYes } from "../../src/openapi/user-yes.js";

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

describe("x-needs-user-yes: an edit needs the yes only when its body can start, spend or send (SOPHIE-NO-FALSE-READY-1111)", () => {
  const served = (key: string) => {
    const [method, path] = key.split(" ");
    return pub.paths[path]?.[method.toLowerCase()]?.[USER_YES_EXTENSION];
  };
  // chat-service's reading of the marker today (notNeededWhen only): a body it calls harmless must stay harmless here.
  const legacyNeedsYes = (m: any, body: Record<string, unknown>) =>
    !(m.notNeededWhen ?? []).some((e: Record<string, unknown>) =>
      Object.entries(e).every(([k, v]) => JSON.stringify(body[k]) === JSON.stringify(v)),
    );

  it("sales funnel campaign edit: a brief or a target alone needs no yes; activate needs it with the running sentence", () => {
    const m = served("PATCH /v1/sales-funnel-campaigns/{id}");
    expect(needsUserYes(m, { brief: "Every email names the client's city." })).toBe(false);
    expect(needsUserYes(m, { target: "meeting_booked" })).toBe(false);
    expect(needsUserYes(m, { followsPlan: true })).toBe(false);
    expect(needsUserYes(m, { status: "stop", brief: "x" })).toBe(false);
    expect(needsUserYes(m, { status: "activate" })).toBe(true);
    expect(needsUserYes(m, { status: "activate", brief: "x" })).toBe(true);
    expect(m.why).toBe(
      "Sets the whole sales funnel campaign running: it finds and contacts people and spends up to the funnel's max budget.",
    );
    expect(m.neededWhen).toEqual([{ status: "activate" }]);
  });

  it("campaign edit: every body can carry a budget, so every edit but a stop asks, with a why true for each", () => {
    const m = served("PATCH /v1/campaigns/{id}");
    expect(needsUserYes(m, { status: "stop" })).toBe(false);
    expect(needsUserYes(m, { status: "activate" })).toBe(true);
    expect(needsUserYes(m, { dailyBudgetCents: 5000 })).toBe(true);
    expect(m.why).toMatch(/resuming it/);
    expect(m.why).toMatch(/budget/);
  });

  it("qualification check edit: renaming or rewording needs no yes; turning it on does", () => {
    const m = served("PATCH /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}");
    expect(needsUserYes(m, { name: "Has a sales team" })).toBe(false);
    expect(needsUserYes(m, { enabled: false })).toBe(false);
    expect(needsUserYes(m, { enabled: true })).toBe(true);
  });

  it("audience status: only active feeds campaigns", () => {
    const m = served("PATCH /v1/orgs/audiences/{id}/status");
    for (const status of ["suggested", "paused", "archived"]) expect(needsUserYes(m, { status })).toBe(false);
    expect(needsUserYes(m, { status: "active" })).toBe(true);
  });

  it("messaging account edit: a persona edit sends nothing; turning the AI or outreach on does", () => {
    const m = served("PATCH /v1/orgs/matrix/links/{linkId}");
    expect(needsUserYes(m, { brandId: "b", persona: { name: "Sophie" } })).toBe(false);
    expect(needsUserYes(m, { brandId: "b", automationAllowed: false })).toBe(false);
    for (const body of [{ automationAllowed: true }, { outreachDefault: true }, { accountType: "pro_ai" }, { lineRole: "assistant" }]) {
      expect(needsUserYes(m, { brandId: "b", ...body })).toBe(true);
    }
  });

  it("every neededWhen marker: a body the old reading calls harmless stays harmless, and a neededWhen body always asks", () => {
    for (const [key, decision] of Object.entries(USER_YES_DECISIONS)) {
      if (!decision?.neededWhen) continue;
      for (const entry of decision.notNeededWhen ?? []) expect(needsUserYes(decision, entry)).toBe(false);
      for (const entry of decision.neededWhen) {
        expect(needsUserYes(decision, entry), key).toBe(true);
        expect(legacyNeedsYes(decision, entry), key).toBe(true);
      }
    }
  });

  it("no notNeededWhen value is one the producer can never receive (PATCH /v1/campaigns/{id} said `stopped`)", () => {
    expect(USER_YES_DECISIONS["PATCH /v1/campaigns/{id}"]?.notNeededWhen).toEqual([{ status: "stop" }]);
  });
});
