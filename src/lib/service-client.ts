/**
 * Service client for calling other distribute services
 * All services require API key authentication via X-API-Key header
 */
import { Agent, type Dispatcher } from "undici";

// Shared undici dispatcher for journalists-quotes-service.
// /orgs/opportunities/discover (batch scorer) and /next run heavy RAG scoring on
// large brand-sets and can legitimately take 5–10 minutes. Node's default undici
// headersTimeout (300s) surfaces as UND_ERR_HEADERS_TIMEOUT before the downstream
// finishes; this bumps headers + body timeout to 10 minutes for that one service only.
const JOURNALISTS_QUOTES_DISPATCHER: Dispatcher = new Agent({
  headersTimeout: 600_000,
  bodyTimeout: 600_000,
});

const TRANSIENT_FETCH_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_FETCH_ERROR_MESSAGE = /\b(EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|UND_ERR_SOCKET)\b|timeout (expired|exceeded)|other side closed/i;
const TRANSIENT_FETCH_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

function findTransientFetchCause(error: unknown, seen = new Set<unknown>()): string | null {
  if (!error || typeof error !== "object" || seen.has(error)) return null;
  seen.add(error);

  const err = error as {
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
    message?: unknown;
    statusCode?: unknown;
  };

  if (typeof err.statusCode === "number") return null;

  if (typeof err.code === "string" && TRANSIENT_FETCH_ERROR_CODES.has(err.code)) {
    return err.code;
  }

  if (typeof err.message === "string") {
    const match = err.message.match(TRANSIENT_FETCH_ERROR_MESSAGE);
    if (match) return match[1] || match[0];
  }

  const cause = findTransientFetchCause(err.cause, seen);
  if (cause) return cause;

  if (Array.isArray(err.errors)) {
    for (const item of err.errors) {
      const nested = findTransientFetchCause(item, seen);
      if (nested) return nested;
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTransientNetworkRetry(
  url: string,
  init: RequestInit & { dispatcher?: Dispatcher },
  method: string,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      const cause = findTransientFetchCause(error);
      const delayMs = TRANSIENT_FETCH_RETRY_DELAYS_MS[attempt];
      if (!cause || delayMs === undefined) throw error;

      console.log(
        `[api-service] [callExternalService] ${method} ${url} transient network failure (cause: ${cause}); retrying ${attempt + 1}/${TRANSIENT_FETCH_RETRY_DELAYS_MS.length} after ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }
}

export const externalServices = {
  client: {
    url: process.env.CLIENT_SERVICE_URL || "http://localhost:3002",
    apiKey: process.env.CLIENT_SERVICE_API_KEY || "",
  },
  emailgen: {
    url: process.env.CONTENT_GENERATION_SERVICE_URL || "https://content-generation.distribute.you",
    apiKey: process.env.CONTENT_GENERATION_SERVICE_API_KEY || "",
  },
  lead: {
    url: process.env.LEAD_SERVICE_URL || "http://localhost:3006",
    apiKey: process.env.LEAD_SERVICE_API_KEY || "",
  },
  campaign: {
    url: process.env.CAMPAIGN_SERVICE_URL || "http://localhost:3004",
    apiKey: process.env.CAMPAIGN_SERVICE_API_KEY || "",
  },
  key: {
    url: process.env.KEY_SERVICE_URL || "http://localhost:3001",
    apiKey: process.env.KEY_SERVICE_API_KEY || "",
  },
  replyQualification: {
    url: process.env.REPLY_QUALIFICATION_SERVICE_URL || "http://localhost:3006",
    apiKey: process.env.REPLY_QUALIFICATION_SERVICE_API_KEY || "",
  },
  scraping: {
    url: process.env.SCRAPING_SERVICE_URL || "http://localhost:3010",
    apiKey: process.env.SCRAPING_SERVICE_API_KEY || "",
  },
  emailGateway: {
    url: process.env.EMAIL_GATEWAY_SERVICE_URL || "http://localhost:3009",
    apiKey: process.env.EMAIL_GATEWAY_SERVICE_API_KEY || "",
  },
  transactionalEmail: {
    url: process.env.TRANSACTIONAL_EMAIL_SERVICE_URL || "http://localhost:3008",
    apiKey: process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY || "",
  },
  brand: {
    url: process.env.BRAND_SERVICE_URL || "https://brand.distribute.you",
    apiKey: process.env.BRAND_SERVICE_API_KEY || "",
  },
  runs: {
    url: process.env.RUNS_SERVICE_URL || "https://runs.distribute.you",
    apiKey: process.env.RUNS_SERVICE_API_KEY || "",
  },
  workflow: {
    url: process.env.WORKFLOW_SERVICE_URL || "https://workflow.distribute.you",
    apiKey: process.env.WORKFLOW_SERVICE_API_KEY || "",
  },
  billing: {
    url: process.env.BILLING_SERVICE_URL || "http://localhost:3020",
    apiKey: process.env.BILLING_SERVICE_API_KEY || "",
  },
  chat: {
    url: process.env.CHAT_SERVICE_URL || "http://localhost:3021",
    apiKey: process.env.CHAT_SERVICE_API_KEY || "",
  },
  instantly: {
    url: process.env.INSTANTLY_SERVICE_URL || "http://localhost:3011",
    apiKey: process.env.INSTANTLY_SERVICE_API_KEY || "",
  },
  stripe: {
    url: process.env.STRIPE_SERVICE_URL || "http://localhost:3022",
    apiKey: process.env.STRIPE_SERVICE_API_KEY || "",
  },
  apiRegistry: {
    url: process.env.API_REGISTRY_SERVICE_URL || "http://localhost:3023",
    apiKey: process.env.API_REGISTRY_SERVICE_API_KEY || "",
  },
  pressKits: {
    url: process.env.PRESS_KITS_SERVICE_URL || "https://press-kits.mcpfactory.org",
    apiKey: process.env.PRESS_KITS_SERVICE_API_KEY || "",
  },
  outlet: {
    url: process.env.OUTLETS_SERVICE_URL || "http://localhost:3030",
    apiKey: process.env.OUTLETS_SERVICE_API_KEY || "",
  },
  journalist: {
    url: process.env.JOURNALISTS_SERVICE_URL || "http://localhost:3031",
    apiKey: process.env.JOURNALISTS_SERVICE_API_KEY || "",
  },
  articles: {
    url: process.env.ARTICLES_SERVICE_URL || "http://localhost:3012",
    apiKey: process.env.ARTICLES_SERVICE_API_KEY || "",
  },
  features: {
    url: process.env.FEATURES_SERVICE_URL || "http://localhost:3032",
    apiKey: process.env.FEATURES_SERVICE_API_KEY || "",
  },
  costs: {
    url: process.env.COSTS_SERVICE_URL || "http://localhost:3025",
    apiKey: process.env.COSTS_SERVICE_API_KEY || "",
  },
  google: {
    get url(): string {
      const v = process.env.GOOGLE_SERVICE_URL;
      if (!v) throw new Error("GOOGLE_SERVICE_URL env var is required");
      return v;
    },
    get apiKey(): string {
      const v = process.env.GOOGLE_SERVICE_API_KEY;
      if (!v) throw new Error("GOOGLE_SERVICE_API_KEY env var is required");
      return v;
    },
  },
  journalistsQuotes: {
    get url(): string {
      const v = process.env.JOURNALISTS_QUOTES_SERVICE_URL;
      if (!v) throw new Error("JOURNALISTS_QUOTES_SERVICE_URL env var is required");
      return v;
    },
    get apiKey(): string {
      const v = process.env.JOURNALISTS_QUOTES_SERVICE_API_KEY;
      if (!v) throw new Error("JOURNALISTS_QUOTES_SERVICE_API_KEY env var is required");
      return v;
    },
    dispatcher: JOURNALISTS_QUOTES_DISPATCHER,
  },
  aiVisibility: {
    get url(): string {
      const v = process.env.AI_VISIBILITY_SCORE_SERVICE_URL;
      if (!v) throw new Error("AI_VISIBILITY_SCORE_SERVICE_URL env var is required");
      return v;
    },
    get apiKey(): string {
      const v = process.env.AI_VISIBILITY_SCORE_SERVICE_API_KEY;
      if (!v) throw new Error("AI_VISIBILITY_SCORE_SERVICE_API_KEY env var is required");
      return v;
    },
  },
  ahref: {
    get url(): string {
      const v = process.env.AHREF_SERVICE_URL;
      if (!v) throw new Error("AHREF_SERVICE_URL env var is required");
      return v;
    },
    get apiKey(): string {
      const v = process.env.AHREF_SERVICE_API_KEY;
      if (!v) throw new Error("AHREF_SERVICE_API_KEY env var is required");
      return v;
    },
  },
  // Lazy reads so an api-service deploy that lands BEFORE the Railway vars are set
  // degrades to a 502 on the audiences routes only (statusCode propagated to the
  // route catch), never a boot-loop. Boot never touches these getters.
  human: {
    get url(): string {
      const v = process.env.HUMAN_SERVICE_URL;
      if (!v) {
        const err = new Error("HUMAN_SERVICE_URL env var is required") as Error & { statusCode: number };
        err.statusCode = 502;
        throw err;
      }
      return v;
    },
    get apiKey(): string {
      const v = process.env.HUMAN_SERVICE_API_KEY;
      if (!v) {
        const err = new Error("HUMAN_SERVICE_API_KEY env var is required") as Error & { statusCode: number };
        err.statusCode = 502;
        throw err;
      }
      return v;
    },
  },
  crm: {
    get url(): string {
      const v = process.env.CRM_SERVICE_URL;
      if (!v) {
        const err = new Error("CRM_SERVICE_URL env var is required") as Error & { statusCode: number };
        err.statusCode = 502;
        throw err;
      }
      return v;
    },
    get apiKey(): string {
      const v = process.env.CRM_SERVICE_API_KEY;
      if (!v) {
        const err = new Error("CRM_SERVICE_API_KEY env var is required") as Error & { statusCode: number };
        err.statusCode = 502;
        throw err;
      }
      return v;
    },
  },
};

interface ServiceCallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
}

// Call external service (with API key)
export async function callExternalService<T>(
  service: { url: string; apiKey: string; dispatcher?: Dispatcher },
  path: string,
  options: ServiceCallOptions = {}
): Promise<T> {
  const { data } = await callExternalServiceWithStatus<T>(service, path, options);
  return data;
}

// Like callExternalService but also returns the upstream HTTP status code
export async function callExternalServiceWithStatus<T>(
  service: { url: string; apiKey: string; dispatcher?: Dispatcher },
  path: string,
  options: ServiceCallOptions = {}
): Promise<{ status: number; data: T }> {
  const { method = "GET", body, headers = {} } = options;

  const url = `${service.url}${path}`;

  try {
    const init: RequestInit & { dispatcher?: Dispatcher } = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": service.apiKey,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    };
    if (service.dispatcher) init.dispatcher = service.dispatcher;
    const response = await fetchWithTransientNetworkRetry(url, init, method);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[callExternalService] ${method} ${url} upstream error ${response.status}:`, errorText);
      // Passthrough upstream body verbatim — gateway is transparent (CLAUDE.md rule #6).
      // LLM/MCP callers need the real root cause; generic "Service call failed" is undebuggable.
      const message = errorText || `Service call failed: ${response.status}`;
      const err = new Error(message) as Error & { statusCode: number };
      err.statusCode = response.status;
      throw err;
    }

    const data: T = await response.json();
    return { status: response.status, data };
  } catch (error: any) {
    const cause = error.cause ? ` (cause: ${error.cause?.code || error.cause?.message || error.cause})` : "";
    console.error(`[callExternalService] ${method} ${url} failed: ${error.message}${cause}`);
    throw error;
  }
}

/**
 * Stream an external service SSE response directly to the Express response.
 * Does NOT buffer or parse — pipes chunks through for real-time streaming.
 */
export async function streamExternalService(
  service: { url: string; apiKey: string; dispatcher?: Dispatcher },
  path: string,
  options: ServiceCallOptions & { expressRes: import("express").Response }
): Promise<void> {
  const { method = "POST", body, headers = {}, expressRes } = options;
  const url = `${service.url}${path}`;

  // Abort the upstream fetch the moment the client socket closes. Without this,
  // a client that disconnects mid-stream (closed tab, navigation, network drop)
  // leaves the read loop below draining the upstream SSE for its full lifetime
  // (chat sessions run 30–60 min) — each orphaned reader pins native undici
  // buffers that never get freed, leaking memory until the container OOMs.
  const controller = new AbortController();
  expressRes.on("close", () => controller.abort());

  const init: RequestInit & { dispatcher?: Dispatcher } = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": service.apiKey,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  };
  if (service.dispatcher) init.dispatcher = service.dispatcher;
  const response = await fetch(url, init);

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`[streamExternalService] ${method} ${path} upstream error: ${response.status}`, errorText);
    expressRes.status(response.status).json({ error: errorText || `Upstream error: ${response.status}` });
    return;
  }

  expressRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  expressRes.flushHeaders();

  const reader = response.body?.getReader();
  if (!reader) {
    expressRes.write(`data: ${JSON.stringify({ error: "No response body" })}\n\n`);
    expressRes.end();
    return;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      expressRes.write(value);
    }
  } catch (err) {
    // controller.abort() on client disconnect surfaces here as an AbortError —
    // that's the expected teardown path, not a failure worth logging as an error.
    if (!controller.signal.aborted) {
      console.error("[streamExternalService] Stream error:", (err as Error).message);
    }
  } finally {
    expressRes.end();
  }
}

/**
 * Stream a multipart/form-data request body straight through to a downstream
 * service without buffering or parsing it. Used for file uploads (e.g. crm-service
 * CSV ingest, up to ~80K rows) where re-encoding the body would corrupt the
 * multipart boundary and buffering the whole file wastes memory.
 *
 * The Express `req` (a Node Readable) is passed as the fetch body with
 * `duplex: "half"`; the original `content-type` (INCLUDING the multipart
 * boundary) and `content-length` are forwarded verbatim, plus the identity
 * headers and `X-API-Key`. The upstream JSON response is parsed and returned
 * with its status. On a non-2xx the upstream body is thrown verbatim (CLAUDE.md
 * rule #7) with `statusCode` set, so the route can surface it to the client.
 *
 * No transient-network retry here: the request stream is single-use and can't be
 * replayed once consumed.
 */
export async function streamMultipartUpload<T>(
  service: { url: string; apiKey: string; dispatcher?: Dispatcher },
  path: string,
  options: { req: import("express").Request; headers?: Record<string, string> },
): Promise<{ status: number; data: T }> {
  const { req, headers = {} } = options;
  const url = `${service.url}${path}`;

  const forwardHeaders: Record<string, string> = {
    "X-API-Key": service.apiKey,
    ...headers,
  };
  const contentType = req.headers["content-type"];
  if (contentType) forwardHeaders["content-type"] = contentType;
  const contentLength = req.headers["content-length"];
  if (contentLength) forwardHeaders["content-length"] = contentLength;

  const init: RequestInit & { dispatcher?: Dispatcher; duplex: "half" } = {
    method: "POST",
    headers: forwardHeaders,
    body: req as unknown as ReadableStream,
    duplex: "half",
  };
  if (service.dispatcher) init.dispatcher = service.dispatcher;

  const response = await fetch(url, init);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[streamMultipartUpload] POST ${url} upstream error ${response.status}:`, errorText);
    const message = errorText || `Service call failed: ${response.status}`;
    const err = new Error(message) as Error & { statusCode: number };
    err.statusCode = response.status;
    throw err;
  }

  const data: T = await response.json();
  return { status: response.status, data };
}
