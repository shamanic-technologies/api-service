# api-service

API gateway that authenticates requests and proxies them to downstream microservices. Sits between the dashboard frontend and all backend services.

## Quick Start

**Prerequisites:** Node 20+, pnpm

```bash
pnpm install
cp .env.example .env   # fill in required values
pnpm dev               # starts dev server with hot reload on port 3000
```

## Architecture

```
Client (dashboard / API key)
  -> api-service (auth + middleware)
    -> downstream microservice
```

1. **Authentication** -- Two auth paths:
   - **Admin key** (`X-API-Key` header) -- validated against `ADMIN_DISTRIBUTE_API_KEY`, external IDs resolved via client-service
   - **User key** (`Authorization: Bearer distrib.usr_*`) -- validated via key-service

2. **Middleware** -- Route-tier determines middleware:
   - `/v1/orgs/*` routes: `authenticate` + `requireOrg`
   - `/v1/*` routes: `authenticate`
   - `/internal/*` routes: never exposed to clients
   - Public routes (`/health`, `/public/*`): no auth

3. **Transparent proxy** -- api-service does NOT rename paths, aggregate responses, or transform bodies. It authenticates and forwards. See `CLAUDE.md` for the full proxy convention.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start dev server with hot reload (`tsx watch`) |
| `pnpm build` | Compile TypeScript + generate OpenAPI spec |
| `pnpm start` | Run production build (with Sentry instrumentation) |
| `pnpm test` | Run all tests (`vitest run`) |
| `pnpm test:unit` | Run unit tests only |
| `pnpm test:integration` | Run integration tests only |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm generate:openapi` | Regenerate `openapi.json` from route schemas |

## API Documentation

OpenAPI spec is auto-generated from Zod schemas via `@asteasolutions/zod-to-openapi`.

| URL | Description |
|-----|-------------|
| `/docs` | Full API reference (Scalar UI) -- all endpoints including internal |
| `/public/docs` | Client-facing API reference -- internal/platform endpoints filtered out |
| `/openapi.json` | Raw OpenAPI spec (full) |
| `/public/openapi.json` | Raw OpenAPI spec (client-facing only) |

## Environment Variables

Copy `.env.example` and fill in values. Key categories:

- **Clerk** -- `CLERK_SECRET_KEY` for JWT verification
- **Sentry** -- `SENTRY_DSN` for error tracking
- **Service URLs** -- URLs for downstream services (brand-service, lead-service, billing-service, etc.)
- **Service API keys** -- Service-to-service auth keys for each downstream service
- **App-level keys** -- Third-party API keys (Anthropic, Apollo, Instantly, Stripe) registered with key-service at startup

## Testing

Tests use [Vitest](https://vitest.dev/) with [Supertest](https://github.com/ladjs/supertest) for HTTP assertions.

```bash
pnpm test              # run all tests
pnpm test:unit         # unit tests only (tests/unit)
pnpm test:integration  # integration tests only (tests/integration)
```

## Deployment

**Docker** -- Multi-stage Dockerfile (Node 20). Builder stage compiles TypeScript and shared packages; production stage copies only `dist/` and prod dependencies.

```bash
docker build -t api-service .
docker run -p 3000:3000 --env-file .env api-service
```

**Railway** -- Configured via `railway.json`:
- Dockerfile builder
- Health check at `/health` (30s timeout)
- Restart on failure (max 5 retries)
- Graceful shutdown on SIGTERM (8s drain timeout)
