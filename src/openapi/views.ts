/**
 * Smaller reads of the API document, for an AI agent (API-ONBOARD-DOC-1023).
 *
 * The full customer document is ~1.1 MB (~290k tokens): no model reads it in one
 * go. The distribute.you MCP still reads it whole (it indexes every operation),
 * so the default stays the full document and these are opt-in slices of it,
 * selected on `GET /openapi.json` and `GET /v1/me/openapi.json`:
 *
 *   ?view=onboarding        the dashboard's sign-up flow, step by step (markdown, ~6k tokens)
 *   ?view=index             every operation on one line, grouped by topic (~13k tokens)
 *   ?tag=<topic>[&page=n]   full detail of one topic, paged under PAGE_BUDGET_BYTES
 *   ?operation=<id>[,<id>]  full detail of those operations
 *
 * Every slice is cut from the SAME built document, so a slice never says
 * something the full document does not. The onboarding guide's "send" and
 * "answers" lines are generated from that document too (the producers' served
 * shapes, see downstream-bodies.ts / downstream-responses.ts), never hand-typed.
 */
import { HTTP_METHODS } from "./document.js";

type Json = Record<string, any>;

/**
 * The dashboard's `/get-started` flow (distribute.you `components/v2/get-started`),
 * step for step, same order, same routes. `title` is the dashboard's screen
 * title; `how` says what the user decides or what the dashboard does on its own.
 * `tests/unit/openapi-onboarding.test.ts` fails if a route here leaves the
 * customer document or answers an empty shape.
 */
export interface OnboardingStep {
  title: string;
  how: string;
  operations: string[];
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    title: "Get a key, then: who am I",
    how:
      "Skip the signup if you already hold a key. `GET /v1/me` lists your organizations and their brands; name a brand " +
      "(`brandId`) or an organization (`orgId`) on later calls when you have several.",
    operations: ["POST /v1/agent-signups/start", "POST /v1/agent-signups/complete", "GET /v1/me"],
  },
  {
    title: "We found your next clients (the website)",
    how:
      "Send the client's website as `url` (add `name` for its display name). Keep `brandId`. Then warm up the first email " +
      "with `preview-email/prepare` (fire and forget, answers 202).",
    operations: ["POST /v1/brands", "POST /v1/content/preview-email/prepare"],
  },
  {
    title: "Your company, then Competitors",
    how: "Read what we found about the company and its competitors, and show it to your user to check.",
    operations: ["POST /v1/brands/extract-fields"],
  },
  {
    title: "What you sell",
    how:
      "Propose offers from what your user says they sell, let them keep ONE, confirm it (`chosenIndex` is optional with one " +
      "offer) and keep `chosenOfferId`. Then, on your own: list the offer's qualification checks and ask for suggestions " +
      "when there are none, and get the ideal customer (`icp/suggest` with `offerId`), kept for the next step.",
    operations: [
      "POST /v1/brands/{id}/offers/proposals",
      "POST /v1/brands/{id}/offers/confirm",
      "GET /v1/brands/{id}/offers/{offerId}/qualification/criteria",
      "POST /v1/brands/{id}/offers/{offerId}/qualification/suggestions",
      "POST /v1/brands/{id}/icp/suggest",
    ],
  },
  {
    title: "Who to write to",
    how:
      "Split the ideal customer (`targetAudience`) into up to 6 segments, size them, let your user keep ONE, confirm it " +
      "and keep the audience `id`. If confirm answers 409 the audience exists: list it instead.",
    operations: [
      "POST /v1/orgs/audiences/split",
      "POST /v1/orgs/audiences/split/estimate",
      "POST /v1/orgs/audiences/split/confirm",
      "GET /v1/orgs/audiences",
    ],
  },
  {
    title: "Your signals",
    how: "Your user turns each check on or off and marks it Must have (`mode: must_pass`) or Nice to have (`mode: mention`).",
    operations: ["PATCH /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}"],
  },
  {
    title: "What a client is worth",
    how: "The dollar amount one new client brings: `lifetimeRevenueUsd`.",
    operations: ["PUT /v1/brands/{id}/offers/{offerId}/economics"],
  },
  {
    title: "Your offer, in six points",
    how: "Read the offer's fields (pre-filled for you), let your user correct the key points, save them under `fields`.",
    operations: ["GET /v1/brands/{id}/offers/{offerId}/user-fields", "PUT /v1/brands/{id}/offers/{offerId}/user-fields"],
  },
  {
    title: "What you give away",
    how: "Same route, the offer's fields for what the client gives for free and what it never gives.",
    operations: ["PUT /v1/brands/{id}/offers/{offerId}/user-fields"],
  },
  {
    title: "Companies in your audience",
    how:
      "Show 5 companies (`offset=0&limit=5`; retry every 3 s while the audience is still building), run the checks on " +
      "them, then read the preview until it is finished.",
    operations: [
      "GET /v1/orgs/audiences/{id}/preview/companies",
      "POST /v1/brands/{id}/offers/{offerId}/qualification/previews",
      "GET /v1/brands/{id}/offers/{offerId}/qualification/previews/{previewId}",
    ],
  },
  {
    title: "Pick your email style",
    how: "Write one example email for a sample recipient and show it to your user.",
    operations: ["POST /v1/content/preview-email"],
  },
  {
    title: "Your campaigns",
    how:
      "List the offer's sales funnels twice: `containsChannels=lead-sourcing` (finds and writes to new people) and " +
      "`containsChannels=ai-meeting-booking` (books the meetings). Rows come best return first: take the first one of each. " +
      "The dashboard's defaults: $20 a day for the first, up to $10 a week for meetings, and a $9,000 monthly limit on the " +
      "account (`monthly_charge_limit_cents`).",
    operations: ["GET /v1/offers/{offerId}/sales-funnels", "PUT /v1/billing/accounts/monthly_charge_limit"],
  },
  {
    title: "Prepay",
    how:
      "A human pays the returned `url`; `prepaid_status` says when it is `active`. An account opened through " +
      "`/v1/agent-signups` has no free credit, so a step above that spends money answers `402 payment_required` until " +
      "this is paid: do this step first on such an account.",
    operations: ["POST /v1/billing/accounts/prepaid_checkout", "GET /v1/billing/accounts/prepaid_status"],
  },
  {
    title: "Start",
    how:
      "Build the audience portfolio, then for each funnel state its max budget first (`maxBudget: {amountCents, period}`, " +
      "`maxVolume: null`) and create its campaign with `status: \"ongoing\"`: the lead-sourcing one first, then the meeting " +
      "one. Name who answers the meetings (`sales-rep`).",
    operations: [
      "POST /v1/orgs/audiences/portfolio",
      "PUT /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps",
      "POST /v1/sales-funnel-campaigns",
      "PUT /v1/brands/{id}/sales-rep",
    ],
  },
  {
    title: "How to decide each step",
    how: "The method our own Copilot follows: what to ask your user, what a good offer or audience looks like.",
    operations: ["GET /v1/skills", "GET /v1/skills/{slug}"],
  },
];

/** Every route of the flow, once, in order. */
export const ONBOARDING_OPERATIONS: readonly string[] = [...new Set(ONBOARDING_STEPS.flatMap((s) => s.operations))];

/** A tag page (its operations + the components they reach) stays under this many bytes (~18k tokens). */
export const PAGE_BUDGET_BYTES = 70_000;

export type DocumentSelection =
  | { kind: "full" }
  | { kind: "index" }
  | { kind: "onboarding" }
  | { kind: "tag"; tag: string; page: number }
  | { kind: "operations"; ids: string[] };

export interface SelectionError {
  error: string;
  code: "invalid_view" | "invalid_tag" | "invalid_page" | "invalid_operation";
  fix: string;
  [k: string]: unknown;
}

/** Read the selection off a catalogue request's query. Never a silent fallback: an unknown value is a 400. */
export function parseSelection(query: Record<string, unknown>): DocumentSelection | SelectionError {
  const one = (v: unknown) => (Array.isArray(v) ? v.join(",") : v === undefined ? undefined : String(v));
  const view = one(query.view);
  const tag = one(query.tag);
  const operation = one(query.operation);
  const page = one(query.page);
  const picked = [view && view !== "full", tag, operation].filter(Boolean).length;
  if (picked > 1) {
    return { error: "Pick one of view, tag or operation", code: "invalid_view", fix: "Send only one of ?view=, ?tag=, ?operation=." };
  }
  if (view !== undefined && !["full", "index", "onboarding"].includes(view)) {
    return {
      error: "Unknown view",
      code: "invalid_view",
      fix: "Use ?view=onboarding (first client, step by step), ?view=index (every operation on one line), or omit view.",
      views: ["full", "index", "onboarding"],
    };
  }
  if (tag !== undefined) {
    const n = page === undefined ? 1 : Number(page);
    if (!Number.isInteger(n) || n < 1) return { error: "Invalid page", code: "invalid_page", fix: "page is a whole number from 1." };
    return { kind: "tag", tag, page: n };
  }
  if (page !== undefined) return { error: "page needs a tag", code: "invalid_page", fix: "Send ?tag=<topic>&page=<n>." };
  if (operation !== undefined) {
    const ids = operation.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return { error: "Empty operation", code: "invalid_operation", fix: "Send ?operation=<operationId>." };
    return { kind: "operations", ids };
  }
  return { kind: (view ?? "full") as "full" | "index" | "onboarding" };
}

interface OperationRef {
  key: string;
  path: string;
  method: string;
  op: Json;
}

function operationsOf(doc: Json): OperationRef[] {
  const out: OperationRef[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (item as Json)[method];
      if (op) out.push({ key: `${method.toUpperCase()} ${path}`, path, method, op });
    }
  }
  return out;
}

const tagOf = (op: Json): string => (op.tags?.[0] as string | undefined) ?? "Other";

/** Every `#/components/...` ref a node reaches, transitively. */
function refsOf(doc: Json, node: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((n) => refsOf(doc, n, into));
    return into;
  }
  if (!node || typeof node !== "object") return into;
  const ref = (node as Json).$ref;
  if (typeof ref === "string" && ref.startsWith("#/components/") && !into.has(ref)) {
    into.add(ref);
    const [, , section, name] = ref.split("/");
    refsOf(doc, doc.components?.[section]?.[name], into);
  }
  for (const v of Object.values(node)) refsOf(doc, v, into);
  return into;
}

/**
 * Pages of each tag: operations in document order, a new page started where the
 * page's operations plus the components they reach would pass PAGE_BUDGET_BYTES.
 */
export function tagPages(doc: Json): Map<string, string[][]> {
  const componentSize = (ref: string) => {
    const [, , section, name] = ref.split("/");
    return JSON.stringify(doc.components?.[section]?.[name] ?? null).length;
  };
  const pages = new Map<string, string[][]>();
  const state = new Map<string, { bytes: number; refs: Set<string> }>();
  for (const { key, op } of operationsOf(doc)) {
    const tag = tagOf(op);
    const list = pages.get(tag) ?? [[]];
    const current = state.get(tag) ?? { bytes: 0, refs: new Set<string>() };
    const refs = refsOf(doc, op);
    const added = (seen: Set<string>) =>
      JSON.stringify(op).length + [...refs].filter((r) => !seen.has(r)).reduce((n, r) => n + componentSize(r), 0);
    if (list[list.length - 1].length > 0 && current.bytes + added(current.refs) > PAGE_BUDGET_BYTES) {
      list.push([key]);
      state.set(tag, { bytes: added(new Set()), refs });
    } else {
      list[list.length - 1].push(key);
      current.bytes += added(current.refs);
      refs.forEach((r) => current.refs.add(r));
      state.set(tag, current);
    }
    pages.set(tag, list);
  }
  return pages;
}

/** Keep only `keys` (in that order) and every component they reach. */
function keepOperations(doc: Json, keys: string[]): Json {
  const out: Json = {
    ...doc,
    info: {
      ...doc.info,
      description:
        "A slice of the distribute.you API document. `?view=index` lists every operation; `?view=onboarding` opens a first " +
        "client step by step. Send your key as `Authorization: Bearer distrib.usr_...`.",
    },
    paths: {},
  };
  for (const key of keys) {
    const [method, path] = key.split(" ");
    const op = doc.paths?.[path]?.[method.toLowerCase()];
    if (op) (out.paths[path] ??= {})[method.toLowerCase()] = op;
  }
  const components: Json = doc.components ?? {};
  const reachable = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const ref = (node as Json).$ref;
    if (typeof ref === "string" && ref.startsWith("#/components/") && !reachable.has(ref)) {
      reachable.add(ref);
      const [, , section, name] = ref.split("/");
      visit(components[section]?.[name]);
    }
    Object.values(node).forEach(visit);
  };
  visit(out.paths);
  out.components = {};
  for (const [section, entries] of Object.entries(components)) {
    if (section === "securitySchemes") {
      out.components.securitySchemes = entries;
      continue;
    }
    const kept = Object.fromEntries(
      Object.entries(entries as Json).filter(([name]) => reachable.has(`#/components/${section}/${name}`)),
    );
    if (Object.keys(kept).length) out.components[section] = kept;
  }
  const used = new Set(Object.values(out.paths).flatMap((item) => Object.values(item as Json).map((op) => tagOf(op as Json))));
  out.tags = (doc.tags ?? []).filter((t: { name: string }) => used.has(t.name));
  // The root header list points into components.headers, which a slice may not carry.
  delete out["x-response-headers"];
  return out;
}

/** A doc with no operations and `body` appended to the description: an index or a guide is prose. */
function proseDocument(doc: Json, title: string, body: string): Json {
  return {
    openapi: doc.openapi,
    info: { ...doc.info, title, description: `${doc.info.description}\n${body}` },
    servers: doc.servers,
    paths: {},
    components: { securitySchemes: doc.components?.securitySchemes ?? {} },
    "x-deprecation-policy": doc["x-deprecation-policy"],
  };
}

const resolve = (doc: Json, node: Json | undefined): Json | undefined => {
  let current = node;
  for (let hops = 0; current && typeof current.$ref === "string" && hops < 10; hops++) {
    const [, , section, name] = (current.$ref as string).split("/");
    current = doc.components?.[section]?.[name];
  }
  return current;
};

/** `a, b (required) | c, d` of an object schema; allOf members merged. */
function fieldList(doc: Json, schema: Json | undefined, markRequired = true): string {
  const s = resolve(doc, schema);
  if (!s) return "";
  const parts = [s, ...((s.allOf as Json[] | undefined) ?? []).map((x) => resolve(doc, x) ?? {})];
  const props = Object.assign({}, ...parts.map((p) => p.properties ?? {}));
  const required = new Set(parts.flatMap((p) => (p.required as string[] | undefined) ?? []));
  const names = Object.keys(props);
  if (names.length === 0) return s.type === "array" ? "a list" : "";
  return names.map((n) => (markRequired && required.has(n) ? `\`${n}\`*` : `\`${n}\``)).join(", ");
}

function onboardingGuide(doc: Json): string {
  const lines = [
    "## Open a first client, step by step",
    "",
    "The same steps, in the same order, as the dashboard's sign-up flow (https://dashboard.distribute.you/get-started).",
    "For each route: `send` = body fields (`*` required), `query` = query parameters, `answers` = top-level fields of the",
    "success answer. Path ids come from earlier answers: `{id}` / `{brandId}` = the brand, `{offerId}` = the offer.",
    "Full detail of a route: `?operation=<operationId>` on this document (comma-separate several).",
    "",
  ];
  ONBOARDING_STEPS.forEach((step, i) => {
    lines.push(`### ${i + 1}. ${step.title}`, step.how, "");
    for (const key of step.operations) {
      const [method, path] = key.split(" ");
      const op = doc.paths?.[path]?.[method.toLowerCase()];
      if (!op) continue;
      const body = fieldList(doc, op.requestBody?.content?.["application/json"]?.schema);
      const query = ((op.parameters ?? []) as Json[])
        .map((p) => resolve(doc, p) ?? p)
        .filter((p) => p.in === "query")
        .map((p) => `\`${p.name}\`${p.required ? "*" : ""}`)
        .join(", ");
      const success = Object.entries(op.responses ?? {}).find(([code]) => code.startsWith("2"))?.[1] as Json | undefined;
      const answers = fieldList(doc, success?.content?.["application/json"]?.schema, false);
      const bits = [query && `query ${query}`, body && `send ${body}`, answers && `answers ${answers}`].filter(Boolean);
      lines.push(`- \`${key}\` (\`${op.operationId}\`)${bits.length ? ": " + bits.join("; ") : ""}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

function operationIndex(doc: Json): string {
  const pages = tagPages(doc);
  const byTag = new Map<string, OperationRef[]>();
  for (const ref of operationsOf(doc)) byTag.set(tagOf(ref.op), [...(byTag.get(tagOf(ref.op)) ?? []), ref]);
  const lines = [
    "## Every operation, by topic",
    "",
    "One line per operation: `operationId` METHOD path: summary. Full detail: `?operation=<operationId>` (comma-separate",
    "several), or a whole topic with `?tag=<topic>` (and `&page=<n>` when it has pages).",
    "",
  ];
  for (const [tag, refs] of byTag) {
    const n = pages.get(tag)?.length ?? 1;
    lines.push(`### ${tag} (\`?tag=${encodeURIComponent(tag)}\`${n > 1 ? `, pages 1-${n}` : ""})`);
    for (const { key, op } of refs) lines.push(`- \`${op.operationId}\` ${key}: ${op.summary ?? ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Cut a selection out of a built document. Throws a SelectionError-shaped object for an unknown tag/page/operation. */
export function selectDocument(doc: Json, selection: DocumentSelection): Json | SelectionError {
  switch (selection.kind) {
    case "full":
      return doc;
    case "index":
      return proseDocument(doc, `${doc.info.title}: index`, operationIndex(doc));
    case "onboarding":
      return proseDocument(doc, `${doc.info.title}: first client`, onboardingGuide(doc));
    case "tag": {
      const pages = tagPages(doc);
      const list = pages.get(selection.tag);
      if (!list) return { error: "Unknown tag", code: "invalid_tag", fix: "Pick a topic from ?view=index.", tags: [...pages.keys()] };
      const keys = list[selection.page - 1];
      if (!keys) return { error: "No such page", code: "invalid_page", fix: `${selection.tag} has pages 1-${list.length}.`, pages: list.length };
      const out = keepOperations(doc, keys);
      out.info = { ...out.info, title: `${doc.info.title}: ${selection.tag}${list.length > 1 ? ` (page ${selection.page} of ${list.length})` : ""}` };
      return out;
    }
    case "operations": {
      const byId = new Map(operationsOf(doc).map((r) => [r.op.operationId as string, r.key]));
      const unknown = selection.ids.filter((id) => !byId.has(id));
      if (unknown.length) {
        return { error: "Unknown operationId", code: "invalid_operation", fix: "Pick operationIds from ?view=index.", unknown };
      }
      return keepOperations(doc, selection.ids.map((id) => byId.get(id)!));
    }
  }
}

export function isSelectionError(x: unknown): x is SelectionError {
  return !!x && typeof x === "object" && typeof (x as SelectionError).code === "string" && "fix" in (x as object);
}
