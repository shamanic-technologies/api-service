// Sentry is loaded via --import flag in package.json start script
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
import leadsRoutes from "./routes/leads.js";
import activityRoutes from "./routes/activity.js";
import workflowsRoutes from "./routes/workflows.js";
import promptsRoutes from "./routes/prompts.js";
import chatRoutes from "./routes/chat.js";
import billingRoutes from "./routes/billing.js";
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
import pressKitsRoutes from "./routes/press-kits.js";
import featuresRoutes from "./routes/features.js";
import { apiReference } from "@scalar/express-api-reference";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - allow dashboard and MCP clients
app.use(cors({
  origin: [
    "https://dashboard.distribute.you",
    "https://distribute.you",
    "https://performance.distribute.you",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3007",
  ],
  credentials: true,
}));

app.use(express.json());

// OpenAPI spec endpoint
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

// Public routes
app.use(healthRoutes);
app.use(pressKitsRoutes); // public press-kit endpoints (no auth)

// Internal platform routes (API key only, no identity)
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
app.use("/v1", brandRoutes);
app.use("/v1", leadsRoutes);
app.use("/v1", activityRoutes);
app.use("/v1", workflowsRoutes);
app.use("/v1", promptsRoutes);
app.use("/v1", chatRoutes);
app.use("/v1", billingRoutes);
app.use("/v1", emailsRoutes);
app.use("/v1", stripeRoutes);
app.use("/v1", usersRoutes);
app.use("/v1", platformRoutes);
app.use("/v1", emailGatewayRoutes);
app.use("/v1", runsRoutes);
app.use("/v1", contentRoutes);
app.use("/v1", pressKitsRoutes); // authenticated press-kit endpoints
app.use("/v1", featuresRoutes);

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
