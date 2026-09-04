// Sentry is loaded via --import flag in package.json start script
// v0.1.4

// ── Prefix all console output with [api-service] ────────────────────────────
// Shared Railway log streams mix output from multiple containers;
// this makes api-service lines instantly identifiable.
const PREFIX = "[api-service]";
const _log = console.log.bind(console);
const _error = console.error.bind(console);
const _warn = console.warn.bind(console);
console.log = (...args: unknown[]) => _log(PREFIX, ...args);
console.error = (...args: unknown[]) => _error(PREFIX, ...args);
console.warn = (...args: unknown[]) => _warn(PREFIX, ...args);

import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import healthRoutes from "./routes/health.js";
import campaignsRoutes from "./routes/campaigns.js";
import keysRoutes from "./routes/keys.js";
import searchRoutes from "./routes/search.js";
import meRoutes from "./routes/me.js";
import qualifyRoutes from "./routes/qualify.js";
import brandRoutes from "./routes/brand.js";
import brandPauseRoutes from "./routes/brand-pause.js";
import brandSpendableBudgetRoutes from "./routes/brand-spendable-budget.js";
import crmRoutes from "./routes/crm.js";
import scrapingRoutes from "./routes/scraping.js";
import leadsRoutes from "./routes/leads.js";
import conversationsRoutes from "./routes/conversations.js";
import activityRoutes from "./routes/activity.js";
import workflowsRoutes from "./routes/workflows.js";
import promptsRoutes from "./routes/prompts.js";
import chatRoutes from "./routes/chat.js";
import billingRoutes from "./routes/billing.js";
import creditsRoutes from "./routes/credits.js";
import usageDiscountRoutes from "./routes/usage-discount.js";
import instantlyRoutes from "./routes/instantly.js";
import promoCodesRoutes from "./routes/promo-codes.js";
import emailsRoutes from "./routes/emails.js";
import internalEmailsRoutes from "./routes/internal-emails.js";
import stripeRoutes from "./routes/stripe.js";
import usersRoutes from "./routes/users.js";
import platformRoutes from "./routes/platform.js";
import platformChatRoutes from "./routes/platform-chat.js";
import platformKeysRoutes from "./routes/platform-keys.js";
import platformPromptsRoutes from "./routes/platform-prompts.js";
import emailGatewayRoutes from "./routes/email-gateway.js";
import runsRoutes from "./routes/runs.js";
import contentRoutes from "./routes/content.js";
import featuresRoutes from "./routes/features.js";
import quotesRoutes from "./routes/quotes.js";
import visibilityRoutes from "./routes/visibility.js";
import audiencesRoutes from "./routes/audiences.js";
import mailingListsRoutes from "./routes/mailing-lists.js";
import platformUploadsRoutes from "./routes/platform-uploads.js";
import invitesRoutes from "./routes/invites.js";
import waitlistRoutes from "./routes/waitlist.js";
import publicStatsRoutes from "./routes/public-stats.js";
import conversionsRoutes from "./routes/conversions.js";
import costsRoutes from "./routes/costs.js";
import adminRoutes from "./routes/admin.js";
import adminBrandsRoutes from "./routes/admin-brands.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { authenticatePlatform } from "./middleware/auth.js";
import { buildDocument } from "./openapi/document.js";
import { requestId } from "./middleware/request-id.js";
import { apiReference } from "@scalar/express-api-reference";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - allow dashboard, MCP clients, and public landing pages
const corsOrigins: string[] = [
  "https://dashboard.distribute.you",
  "https://distribute.you",
  "https://performance.distribute.you",
  "https://landing.distribute.you",
  "https://sales-cold-emails.distribute.you",
];
if (process.env.NODE_ENV !== "production") {
  corsOrigins.push("http://localhost:3000", "http://localhost:3001", "http://localhost:3007");
}
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  // Browser-side agents can only read these off a cross-origin response if the
  // server says so. Without this the rate-limit state is invisible to exactly
  // the callers that most need to self-throttle.
  exposedHeaders: [
    "RateLimit",
    "RateLimit-Policy",
    "RateLimit-Limit",
    "RateLimit-Remaining",
    "RateLimit-Reset",
    "Retry-After",
    "Deprecation",
    "Sunset",
    "Link",
    "x-request-id",
  ],
}));

// ── Correlation id + rate limiting ───────────────────────────────────────────
// Mounted before every route (docs and health included) so that the headers
// describe every response this gateway sends, and so a throttled request is
// answered here instead of reaching the downstream fleet.
app.use(requestId);
app.use(rateLimit);

// Raised from the 100kb express default: no-website brands post a large
// free-form business-context body (~1MB / ~300k chars, "5 PDFs of 20 pages")
// that brand-service stores + uses as the field-extraction source.
app.use(express.json({ limit: "10mb" }));

// ── OpenAPI ─────────────────────────────────────────────────────────────────
// `openapi.json` is generated for the PUBLIC audience (see
// `src/openapi/document.ts`): it describes the API a customer can actually use
// and says nothing about the platform key or the operations that need it.
//
// Staff still need the complete document — the CLI generates its command
// surface from it — so it is served at `GET /internal/openapi.json` behind the
// platform key. Built on demand from the same registry, so there is no second
// committed file to keep in sync. The OPERATIONS themselves are unchanged:
// removing one from the published document does not remove its route.
const openapiPath = join(__dirname, "..", "openapi.json");
app.get("/openapi.json", (_req, res) => {
  if (existsSync(openapiPath)) {
    const spec = JSON.parse(readFileSync(openapiPath, "utf-8"));
    res.json(spec);
  } else {
    res.status(404).json({ error: "OpenAPI spec not generated yet. Run: pnpm generate:openapi" });
  }
});

// API docs (Scalar)
app.use(
  "/docs",
  apiReference({
    url: "/openapi.json",
    theme: "kepler",
  }),
);

// ── Public OpenAPI spec (client-facing endpoints only) ───────────────────────
const INTERNAL_TAGS = new Set(["Internal", "Platform", "Health", "Email Gateway", "Runs"]);

function buildPublicSpec(): Record<string, unknown> | null {
  if (!existsSync(openapiPath)) return null;
  const spec = JSON.parse(readFileSync(openapiPath, "utf-8"));

  // Filter tags
  if (spec.tags) {
    spec.tags = spec.tags.filter((t: { name: string }) => !INTERNAL_TAGS.has(t.name));
  }

  // Filter paths — remove any path where ALL operations belong to internal tags
  if (spec.paths) {
    const methods = ["get", "post", "put", "patch", "delete"];
    const filteredPaths: Record<string, unknown> = {};

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const filtered: Record<string, unknown> = {};
      for (const method of methods) {
        const op = (pathItem as Record<string, unknown>)[method] as
          | { tags?: string[] }
          | undefined;
        if (!op) continue;
        const isInternal = op.tags?.some((t) => INTERNAL_TAGS.has(t)) ?? false;
        if (!isInternal) {
          filtered[method] = op;
        }
      }
      if (Object.keys(filtered).length > 0) {
        filteredPaths[path] = { ...pathItem as Record<string, unknown>, ...filtered };
        // Clean out removed methods
        for (const method of methods) {
          if (!(method in filtered)) {
            delete (filteredPaths[path] as Record<string, unknown>)[method];
          }
        }
      }
    }
    spec.paths = filteredPaths;
  }

  // Remove apiKeyAuth security scheme (clients only use bearerAuth)
  if (spec.components?.securitySchemes?.apiKeyAuth) {
    delete spec.components.securitySchemes.apiKeyAuth;
  }

  return spec;
}

app.get("/public/openapi.json", (_req, res) => {
  const spec = buildPublicSpec();
  if (spec) {
    res.json(spec);
  } else {
    res.status(404).json({ error: "OpenAPI spec not generated yet. Run: pnpm generate:openapi" });
  }
});

app.use(
  "/public/docs",
  apiReference({
    url: "/public/openapi.json",
    theme: "kepler",
  }),
);

// ── Complete OpenAPI document (staff) ───────────────────────────────────────
// Every operation, both security schemes. `authenticatePlatform` 401s anything
// that does not carry `ADMIN_DISTRIBUTE_API_KEY`, which is the same key the
// documented platform operations themselves require — so this exposes nothing
// to a caller who could not already call them.
app.get("/internal/openapi.json", authenticatePlatform, (_req, res) => {
  res.json(buildDocument({ audience: "staff" }));
});

// Public routes
app.use(healthRoutes);
app.use(featuresRoutes);  // public features endpoints (no auth)
app.use(publicStatsRoutes); // public stats endpoints (no auth)
app.use(conversionsRoutes); // public conversion-tracking ingest (no Clerk auth — token in header)
app.use(costsRoutes); // public costs endpoints (no auth) — declares full /v1/costs/* paths

// Internal platform routes (API key only, no identity)
app.use("/internal", adminRoutes);
app.use("/internal", internalEmailsRoutes);
app.use("/platform-chat", platformChatRoutes);
app.use("/platform-keys", platformKeysRoutes);
app.use("/platform-prompts", platformPromptsRoutes);

// Authenticated routes
app.use("/v1", meRoutes);
app.use("/v1", keysRoutes);
app.use("/v1", campaignsRoutes);
app.use("/v1", searchRoutes);
app.use("/v1", qualifyRoutes);
// Mount BEFORE brandRoutes: /brands/:brandId/pause forwards to campaign-service,
// must win over any future brand-service brand proxy.
app.use("/v1", brandPauseRoutes);
app.use("/v1", brandSpendableBudgetRoutes);
app.use("/v1", brandRoutes);
app.use("/v1", crmRoutes);
app.use("/v1", scrapingRoutes);
app.use("/v1", leadsRoutes);
app.use("/v1", conversationsRoutes);
app.use("/v1", activityRoutes);
app.use("/v1", workflowsRoutes);
app.use("/v1", promptsRoutes);
app.use("/v1", chatRoutes);
app.use("/v1", billingRoutes);
app.use("/v1", creditsRoutes);
app.use("/v1", usageDiscountRoutes);
app.use("/v1", instantlyRoutes);
app.use("/v1", promoCodesRoutes);
app.use("/v1", emailsRoutes);
app.use("/v1", stripeRoutes);
app.use("/v1", usersRoutes);
app.use("/v1", platformRoutes);
app.use("/v1", emailGatewayRoutes);
app.use("/v1", runsRoutes);
app.use("/v1", contentRoutes);
app.use("/v1", featuresRoutes);
app.use("/v1", adminBrandsRoutes);
app.use("/v1", quotesRoutes);
app.use("/v1", visibilityRoutes);
app.use("/v1", invitesRoutes);
app.use("/v1", waitlistRoutes);
app.use("/v1", audiencesRoutes);
app.use("/v1", mailingListsRoutes);
app.use("/v1", platformUploadsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Sentry error handler must be before any other error middleware
Sentry.setupExpressErrorHandler(app);

// Fallback error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Listen on :: for Railway private networking (IPv4 & IPv6 support)
const server = app.listen(Number(PORT), "::", () => {
  console.log(`API Gateway running on port ${PORT}`);
});

// ── HTTP timeouts ────────────────────────────────────────────────────────────
// Node 20 defaults requestTimeout to 5 min (300 000 ms), which kills long-lived
// SSE streams (e.g. chat sessions with LLM tool-calling that can run 30-60 min).
// Disable it so streaming endpoints are not prematurely terminated.
server.requestTimeout = 0;       // no limit on how long a request can take
server.headersTimeout = 60_000;  // 60 s to receive headers (guard against slowloris)
server.keepAliveTimeout = 72_000; // slightly above typical LB idle timeout (60 s)

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Railway sends SIGTERM before stopping a container. Without this handler,
// the process dies immediately — killing in-flight requests and causing 500s.
// We stop accepting new connections and let existing ones drain.
const SHUTDOWN_TIMEOUT_MS = 8_000; // Railway sends SIGKILL after ~10s

function gracefulShutdown(signal: string) {
  console.log(`[shutdown] Received ${signal}, draining connections…`);
  server.close(() => {
    console.log("[shutdown] All connections drained, exiting.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[shutdown] Drain timeout reached, forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { server };
export default app;
