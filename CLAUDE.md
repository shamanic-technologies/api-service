# api-service

API gateway that sits between the dashboard (frontend) and all backend microservices. Authenticates requests and proxies them downstream.

## Proxy Convention

api-service is a **transparent proxy**. It authenticates, applies middleware, and forwards requests — it does NOT redefine, rename, or transform downstream routes.

**"Transparent" does NOT mean "generic catch-all".** Every downstream endpoint requires its own explicit Express handler in `src/routes/<service>.ts`, its own Zod schema in `src/schemas.ts`, and a re-generated `openapi.json`. There is no `app.use("/v1/*", genericProxy)` and adding one is out of scope for any normal feature PR — it would break OpenAPI auto-generation, per-route auth-tier enforcement, query-param whitelisting, and ~30 existing `*-proxy.test.ts` files. If you think you need a generic catch-all, that is a standalone architectural proposal, not a "while we're here" tweak.

"Transparent" means: no path rename, no aggregation, no body transform, no field stripping, no header injection beyond the standard identity headers. It does NOT mean fewer files.

### Rules

1. **No path renaming.** The path sent to the downstream service must match the actual route on that service. Always check the API registry (`mcp__api-registry__list_service_endpoints`) for the correct path before writing a proxy route.

2. **No aggregation logic.** If a response needs enrichment from multiple services, that logic belongs in the backend service, not here. Do NOT build ad-hoc enrichment functions that call multiple services and stitch results together.

3. **Correct middleware per route tier:**
   - Downstream `/orgs/*` routes → `authenticate + requireOrg` (client must provide org context)
   - Downstream `/internal/*` routes → NEVER exposed to clients. api-service may call them server-side when needed, but they are not mounted as client-facing routes.
   - Downstream `/public/*` routes → `authenticate` only

4. **No body transforms.** Don't strip fields from the body or inject fields from headers. Just proxy the request as-is.

5. **No path invention.** If a downstream service doesn't have the route, api-service must NOT invent it. If a route was deprecated upstream, remove the proxy route here too.

### Brand-service path convention

- `/orgs/brands/*` (no ID in path) = org-scoped operations using `x-org-id` / `x-brand-id` headers (list, extract-fields, extract-images)
- `/internal/brands/{id}/*` = by-ID lookups (get brand, extracted-fields, extracted-images, runs)

### Service-client env var names must match Railway

When adding a new entry to `externalServices` in `src/lib/service-client.ts`, the env var name MUST be `<SERVICE>_SERVICE_URL` / `<SERVICE>_SERVICE_API_KEY` where `<SERVICE>` matches the actual Railway service / repo name in screaming snake case (e.g. `ai-visibility-score-service` → `AI_VISIBILITY_SCORE_SERVICE_URL`, NOT `AI_VISIBILITY_SERVICE_URL`).

Verify with `mcp__railway__list-variables` BEFORE shipping. Unit tests pass either way (they assert what the source contains, not what Railway has) — only a runtime call exposes the mismatch as a 500. Hotfix v0.36.1 fixed this for `ai-visibility-score-service` after dashboard 500s.

### Pagination params on list endpoints

Never add `.default()` or `.max()` on `limit` / `pageSize` / `per_page` / `count` query/body Zod schemas at the api-service layer. Callers get whatever the downstream service returns. Silent caps caused truncated-result bugs (outlets-service hotfix v0.2.1). Enforced by `tests/unit/no-limit-defaults.regression.test.ts` — it WILL fail your build if you add one.

### Future direction

New proxy routes should follow the pattern `/v1/{service-name}/{original-downstream-path}` to make the mapping obvious and mechanical. Existing routes keep their current shape to avoid breaking clients.
