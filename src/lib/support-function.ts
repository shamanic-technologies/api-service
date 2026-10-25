/**
 * Support functions of the gateway's request runs (COST-SUPPORT-1024, owner
 * 2026-10-24, cost-accounting doctrine "Support functions, reported apart").
 *
 * Every authenticated request opens ONE root run here (`authenticate`); the
 * downstream spend of that request rides it. Spend that produces no outcome BY
 * DESIGN (the Copilot, onboarding / product features, reading a brand) is marked
 * at run creation with its runs-service support function, so it never rides a
 * cost per outcome and is reported apart per function.
 *
 * The table is an ALLOW-list measured on prod (gateway runs since 2026-02-02,
 * 7,464 with spend under them): a route is listed when its function is support
 * by design and (nearly) none of its runs ever had an outcome declared under
 * it. A marked root never takes anything off a declaring descendant: runs-service
 * stops a run's walk at its nearest declaring run first, so an outcome a Copilot
 * turn caused (3 of 1,068 Copilot runs) keeps its cost; only the spend no one
 * declared becomes support. A route that PRODUCES outcomes (campaign creation,
 * replying to an opportunity, sending an email, activating an audience) is NOT
 * listed: its spend left undeclared must stay visible as "undeclared" until its
 * producer declares it, never be hidden as support. An unlisted route = no mark.
 *
 * `PATCH /v1/campaigns/:id` (and its `/stop` twin) is deliberately UNLISTED although
 * most edits spend nothing: resuming a campaign makes campaign-service start the
 * campaign's workflow AS A CHILD of this request run (prod 2026-10-25, LEDGER-RESIDUAL-1025:
 * 3 such roots carried lead serve + Apollo enrichment/verify-email + judgments). A mark
 * here would relabel that undeclared PRODUCTION as support. A past edit whose subtree
 * holds no workflow is marked by run id through the owner door instead.
 */

export type SupportFunction = "copilot" | "product_feature" | "brand_setup" | "retired_product";

const ID = "[^/]+";

type Rule = { method: string; path: RegExp; fn: SupportFunction; reason: string };

const rule = (method: string, path: string, fn: SupportFunction, reason: string): Rule => ({
  method,
  path: new RegExp(`^${path.replace(/:id/g, ID)}$`),
  fn,
  reason,
});

export const SUPPORT_RULES: readonly Rule[] = [
  rule("POST", "/v1/chat", "copilot", "Copilot conversation"),

  rule("POST", "/v1/brands", "brand_setup", "brand creation"),
  rule("POST", "/v1/brands/extract-fields", "brand_setup", "brand field extraction"),
  rule("POST", "/v1/brands/:id/extract-fields", "brand_setup", "brand field extraction"),

  rule("POST", "/v1/orgs/audiences/suggest", "product_feature", "onboarding: audience suggestions"),
  rule("POST", "/v1/orgs/audiences/split", "product_feature", "onboarding: audience split"),
  rule("POST", "/v1/orgs/audiences/split/estimate", "product_feature", "onboarding: audience split estimate"),
  rule("POST", "/v1/orgs/audiences/split/confirm", "product_feature", "onboarding: audience split confirm"),
  rule("POST", "/v1/orgs/audiences/portfolio", "product_feature", "onboarding: audience portfolio"),
  rule("POST", "/v1/orgs/audiences/:id/avatar", "product_feature", "audience avatar"),
  rule("GET", "/v1/orgs/audiences/:id/preview/companies", "product_feature", "audience preview"),
  rule("POST", "/v1/orgs/audiences/:id/preview/companies/:id/email-check", "product_feature", "audience preview email check"),
  rule("POST", "/v1/orgs/audiences/:id/preview/email-checks/next", "product_feature", "audience preview email check"),
  rule("POST", "/v1/brands/:id/icp/suggest", "product_feature", "onboarding: ICP suggestion"),
  rule("POST", "/v1/brands/:id/competitors/discover", "product_feature", "onboarding: competitor discovery"),
  rule("POST", "/v1/brands/:id/personas/:id/avatar/regenerate", "product_feature", "persona avatar"),
  rule("POST", "/v1/brands/:id/offers/:id/image", "product_feature", "offer image"),
  rule("POST", "/v1/brands/:id/offers/:id/qualification/previews", "product_feature", "qualification preview"),
  rule("POST", "/v1/features/:id/prefill", "product_feature", "onboarding: feature prefill"),
  rule("POST", "/v1/content/preview-email", "product_feature", "email preview"),
  rule("POST", "/v1/content/preview-email/prepare", "product_feature", "email preview"),
  rule("POST", "/v1/orgs/domains/traffic-compute", "product_feature", "domain traffic read"),
  rule("POST", "/v1/orgs/domains/dr-compute", "product_feature", "domain rating read"),
  rule("POST", "/v1/activity", "product_feature", "activity tracking"),
  rule("POST", "/v1/workflows/create", "product_feature", "workflow authoring"),
  rule("POST", "/v1/workflows/upgrade", "product_feature", "workflow authoring"),
  rule("POST", "/v1/workflows/generate", "product_feature", "workflow authoring"),

  // Products no longer in the fleet (journalists, outlets: removed in v0.98.0).
  rule("GET", "/v1/campaigns/:id/journalists", "retired_product", "journalists (retired)"),
  rule("POST", "/v1/outlets/price-requests", "retired_product", "outlets (retired)"),

  // A read: no GET request run ever had an outcome declared under it (prod, since 2026-02-02).
  rule("GET", ".*", "product_feature", "dashboard read"),
];

/**
 * The support function of a gateway request run, or null (no mark).
 * `path` is the full request path (`req.baseUrl + req.path`), query excluded.
 */
export function supportFunctionFor(
  method: string,
  path: string,
): { kind: SupportFunction; reason: string } | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  for (const r of SUPPORT_RULES) {
    if (r.method === method.toUpperCase() && r.path.test(clean)) {
      return { kind: r.fn, reason: `api-service: ${r.reason}` };
    }
  }
  return null;
}
