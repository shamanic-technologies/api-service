# api-service

API gateway that sits between the dashboard (frontend) and all backend microservices. Authenticates requests and proxies them downstream.

## Proxy Convention

api-service is a **transparent proxy**. It authenticates, applies middleware, and forwards requests — it does NOT redefine, rename, or transform downstream routes.

**"Transparent" does NOT mean "generic catch-all".** Every downstream endpoint requires its own explicit Express handler in `src/routes/<service>.ts`, its own Zod schema in `src/schemas.ts`, and a re-generated `openapi.json`. There is no `app.use("/v1/*", genericProxy)` and adding one is out of scope for any normal feature PR — it would break OpenAPI auto-generation, per-route auth-tier enforcement, query-param whitelisting, and ~30 existing `*-proxy.test.ts` files. If you think you need a generic catch-all, that is a standalone architectural proposal, not a "while we're here" tweak.

"Transparent" means: no path rename, no aggregation, no body transform, no field stripping, no header injection beyond the standard identity headers. It does NOT mean fewer files.

### Rules

1. **No path renaming.** The path sent to the downstream service must match the actual route on that service. Always check the API registry (`mcp__api-registry__list_service_endpoints`) for the correct path before writing a proxy route. When a downstream path is renamed (e.g. `auto-reload` → `auto_topup`), the api-service-facing path must be renamed in lockstep — do NOT keep a legacy client alias pointing at the new downstream path. The dashboard PR catches up; cross-repo coordination is mandatory, not optional.

2. **No aggregation logic.** If a response needs enrichment from multiple services, that logic belongs in the backend service, not here. Do NOT build ad-hoc enrichment functions that call multiple services and stitch results together.

3. **Correct middleware per route tier:**
   - Downstream `/orgs/*` routes → `authenticate + requireOrg` (client must provide org context)
   - Downstream `/internal/*` routes → NEVER exposed to clients. api-service may call them server-side when needed, but they are not mounted as client-facing routes.
   - Downstream `/public/*` routes → `authenticate` only

4. **No body transforms.** Don't strip fields from the body or inject fields from headers. Just proxy the request as-is.

5. **No path invention.** If a downstream service doesn't have the route, api-service must NOT invent it. If a route was deprecated upstream, remove the proxy route here too.

6. **No shape assertions on pass-through responses.** Billing and any other endpoint whose response schema is `z.object({}).passthrough()` is owned by the downstream service. Do NOT write api-service unit tests that assert specific field names or types on those responses — they only re-encode the downstream contract here and force coordinated edits on every downstream rename. Tests must assert (a) the proxy forwarded to the correct downstream path, and (b) the upstream body was forwarded byte-identical. That is the entire contract.

7. **No sanitizing upstream error bodies.** `callExternalService` (`src/lib/service-client.ts`) throws `Error.message = <upstream body verbatim>` on non-2xx; routes surface it to the client via `res.json({ error: err.message })`. Do NOT re-introduce a generic `Service call failed: <status>` mask, do NOT JSON-extract only the `error` field, do NOT truncate. Downstream services are ours, behind the same trust boundary as the gateway — PII / stack-trace hygiene is enforced at the downstream layer, not by double-masking here. LLM/MCP callers (dashboard agent, MCP tool callers) cannot debug without the real upstream message. This rule supersedes PR #437 finding S5; the security audit was over-cautious for an internal microservice mesh. Hotfix v0.41.2 (PR #462) restored passthrough after agents hit opaque `{"error":"Service call failed: 500"}` from `/workflows/upgrade`.

8. **Response schemas are passthrough by default — no field declaration.** Every proxied response schema in `src/schemas.ts` MUST be `z.object({}).passthrough().openapi("<Name>")`. Do NOT re-declare downstream fields. Downstream owns the shape; api-service forwards bytes. Field rename downstream = zero edit here. Three precedents codify this: billing PR #454 ("collapse billing response schemas to passthrough"), runs PR #455 (response schema correction after re-declaration drift), brand contract change (this rule's birth). The ONLY exception is a response shape api-service itself constructs via aggregation (e.g. `BrandRunsResponse` enriches with `runs-client` cost data) — those are typed accessors, and the route handler MUST cite the construction site in a comment. If a typed response schema exists and no aggregation justifies it, collapse it to passthrough — that is always safe.

9. **SSE / streaming proxies MUST go through `streamExternalService` — never hand-roll a `fetch` + manual pipe.** `streamExternalService` (`src/lib/service-client.ts`) wires an `AbortController` to the client socket: it passes `signal` to the upstream `fetch` and calls `controller.abort()` on `expressRes` `"close"`, so a client that disconnects mid-stream (closed tab, navigation, network drop) tears down the upstream connection instead of leaking it. This is LOAD-BEARING: `server.requestTimeout = 0` (set for long SSE) means nothing else reaps an orphaned stream. A raw `fetch` + `reader.read()` loop without abort-on-disconnect keeps draining the upstream SSE for its full lifetime (chat sessions run 30–60 min); each orphaned reader pins native undici buffers that never free → RSS climbs to the 8GB Railway limit → OOM-restart sawtooth. Diagnostic tell: 8GB RSS on a "pure passthrough" = native buffers, NOT V8 heap (no `--max-old-space-size`, heap caps ~4GB). Hotfix v0.72.2 (PR #617) added the abort wiring after prod OOM-cycled. The campaign-stream poll loop (`src/routes/campaigns.ts`) is the one exception — it self-manages its own `req.on("close")` cleanup and does not use `streamExternalService`.

### Staff / admin gating — `authenticatePlatform` + `requireStaff`

`authenticate` does NOT distinguish a staff user from a normal customer (it only sets `authType: "admin" | "user_key"`), and **`authenticatePlatform` alone is NOT a staff gate** — the platform key (`ADMIN_DISTRIBUTE_API_KEY`) is shared with the customer dashboard's server-side proxy, so `authType === "admin"` is true for ordinary customer traffic too. Two mechanisms, pick by what the route exposes:

- **Pure platform op, no customer-distinguishing needed** (`/admin/*`, internal ops that any admin-keyed caller may hit) → **`authenticatePlatform`** (`src/middleware/auth.ts`): requires `X-API-Key === ADMIN_DISTRIBUTE_API_KEY`, else 401. Precedent: `src/routes/promo-codes.ts` (PR #538).
- **STAFF-ONLY** (mutating grants, cross-org ledgers, fleet-wide ops data the customer dashboard must NOT reach) → **`authenticatePlatform` + `requireStaff`** (or `authenticate + requireOrg + requireStaff` when org context is also needed). `requireStaff` (`src/middleware/auth.ts`) requires `authType === "admin"` AND a forwarded `x-email` in the `STAFF_EMAILS` allowlist — the email is the staff signal the shared platform key can't provide. Non-staff → 403. Precedents: `src/routes/credits.ts` (`POST /v1/billing/credits/grant`, `GET /v1/billing/credits/grants/all`), `src/routes/instantly.ts` (`GET /v1/instantly/audit/sending-forecast`, PR #632).

Do NOT invent a new staff-role flag. Do NOT gate a staff-only route with `authenticatePlatform` alone — a customer's dashboard session carries the same admin key, so it would leak. Use `requireStaff` for the staff signal.

### Brand-service path convention

- `/orgs/brands/*` (no ID in path) = org-scoped operations using `x-org-id` / `x-brand-id` headers (list, extract-fields, extract-images)
- `/internal/brands/{id}/*` = single-brand by-ID lookups (get brand, extracted-fields, extracted-images, runs)
- `/internal/brands?ids=csv` = batch by-ID lookup (proxied here as `GET /v1/brands/by-ids?ids=csv`). Preferred over fan-out `Promise.all` against the single-brand endpoint. Caller is responsible for staying within brand-service's per-request cap — if exceeded, brand-service returns 400 and the error is propagated verbatim. Do NOT add chunking, retry, or aggregation logic at this layer (rule #2). The dashboard owns batching across multiple requests when it has >cap brands to resolve.

### Service-client env var names must match Railway

When adding a new entry to `externalServices` in `src/lib/service-client.ts`, the env var name MUST be `<SERVICE>_SERVICE_URL` / `<SERVICE>_SERVICE_API_KEY` where `<SERVICE>` matches the actual Railway service / repo name in screaming snake case (e.g. `ai-visibility-score-service` → `AI_VISIBILITY_SCORE_SERVICE_URL`, NOT `AI_VISIBILITY_SERVICE_URL`).

Verify with `mcp__railway__list-variables` BEFORE shipping. Unit tests pass either way (they assert what the source contains, not what Railway has) — only a runtime call exposes the mismatch as a 500. Hotfix v0.36.1 fixed this for `ai-visibility-score-service` after dashboard 500s.

### Pagination params on list endpoints

Never add `.default()` or `.max()` on `limit` / `pageSize` / `per_page` / `count` query/body Zod schemas at the api-service layer. Callers get whatever the downstream service returns. Silent caps caused truncated-result bugs (outlets-service hotfix v0.2.1). Enforced by `tests/unit/no-limit-defaults.regression.test.ts` — it WILL fail your build if you add one.

### Diagnosing a "gateway route hangs / is slow but downstream serves fine"

The gateway is a pure passthrough: on a proxy route it does `callExternalService` → `res.json`, adding ~0 overhead when the downstream responds warm. So a report of "gateway times out but the downstream endpoint is fast directly" is almost never a gateway bug — it is downstream cold-state (request-path cache/dataset build, Neon scale-to-zero wake, cold Railway container). **Do NOT add a cache / warm-loop / per-route timeout / connection-prewarm to the gateway to "fix" it — that violates rules #2/#8 and would only surface the fallback faster, not the real data. The fix belongs downstream.**

The "direct is fast / gateway is slow" asymmetry is usually a **measurement artifact**: the first call (whichever path) warms the downstream's shared cache, so the *second-measured* path looks artificially fast. To diagnose correctly, control for warm-state:
- Measure the UNTOUCHED path FIRST after a genuine idle (past the downstream's cache TTL) — hit **direct, bypassing the gateway**; if direct-cold is also slow, the gateway is exonerated.
- The tell for a shared downstream cold build: N concurrent requests all **return together at the same elevated latency** (one cold `O(brands)`/`O(N)` fan-out they all block on), then everything is fast for the cache-TTL window.
- Check the downstream's prod Neon compute suspend setting (`list_branch_computes`) and its own repo issues before blaming the gateway — a never-suspend DB rules out DB cold-start and points at a request-path build.

Incident 2026-07-11 (public cost-per-outcome-trend "gateway timeout"): brief pinned it on the gateway; profiling showed gateway warm-overhead ~0, and a 5.5-min-idle direct-first A/B gave direct-cold ~11.6s / gateway-warm 0.32s — the gateway was innocent. Root cause was features-service's shared goal-bucket dataset cold-building on the request path (its own issue #547's documented next-lever); fixed there via SWR warm-off-request-path (features-service v0.87.7 / #551), no api-service change.

### Future direction

New proxy routes should follow the pattern `/v1/{service-name}/{original-downstream-path}` to make the mapping obvious and mechanical. Existing routes keep their current shape to avoid breaking clients.
