# api-service

API gateway that sits between the dashboard (frontend) and all backend microservices. Authenticates requests and proxies them downstream.

## Proxy Convention

api-service is a **transparent proxy**. It authenticates, applies middleware, and forwards requests — it does NOT redefine, rename, or transform downstream routes.

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

### Future direction

New proxy routes should follow the pattern `/v1/{service-name}/{original-downstream-path}` to make the mapping obvious and mechanical. Existing routes keep their current shape to avoid breaking clients.
