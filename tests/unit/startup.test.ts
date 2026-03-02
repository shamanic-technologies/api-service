import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock auth (required by service-client transitive imports)
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: vi.fn(),
  requireOrg: vi.fn(),
  requireUser: vi.fn(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import { registerPlatformKeys, API_SERVICE_APP_ID } from "../../src/startup.js";

function setAllEnvVars() {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.APOLLO_API_KEY = "apollo-test";
  process.env.INSTANTLY_API_KEY = "instantly-test";
  process.env.FIRECRAWL_API_KEY = "fc-test";
  process.env.GEMINI_API_KEY = "gemini-test";
  process.env.POSTMARK_API_KEY = "postmark-test";
  process.env.STRIPE_SECRET_KEY = "sk_test_stripe";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
}

function deleteAllEnvVars() {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.APOLLO_API_KEY;
  delete process.env.INSTANTLY_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.POSTMARK_API_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

describe("registerPlatformKeys", () => {
  let fetchCalls: Array<{ url: string; body?: Record<string, unknown> }>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, body });

      if (url.includes("/keys") && body?.keySource === "platform") {
        return new Response(JSON.stringify({ provider: body?.provider, maskedKey: "sk-...xxx", message: "Platform key saved" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/internal/app-keys") && body?.appId) {
        return new Response(JSON.stringify({ provider: body?.provider, maskedKey: "sk-...xxx", message: "App key saved" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should register platform keys without appId and stripe keys as app keys", async () => {
    setAllEnvVars();

    await registerPlatformKeys();

    // Platform keys — registered via POST /keys with keySource: "platform"
    const platformKeyCalls = fetchCalls.filter((c) => c.url.includes("/keys") && !c.url.includes("/internal/") && c.body?.keySource === "platform");
    expect(platformKeyCalls).toHaveLength(6);

    const platformProviders = platformKeyCalls.map((c) => c.body?.provider);
    expect(platformProviders).toContain("anthropic");
    expect(platformProviders).toContain("apollo");
    expect(platformProviders).toContain("instantly");
    expect(platformProviders).toContain("firecrawl");
    expect(platformProviders).toContain("gemini");
    expect(platformProviders).toContain("postmark");

    for (const call of platformKeyCalls) {
      expect(call.body).toHaveProperty("keySource", "platform");
      expect(call.body).not.toHaveProperty("appId");
    }

    // App keys — registered via POST /internal/app-keys with appId
    const appKeyCalls = fetchCalls.filter((c) => c.url.includes("/internal/app-keys"));
    expect(appKeyCalls).toHaveLength(2);

    const appProviders = appKeyCalls.map((c) => c.body?.provider);
    expect(appProviders).toContain("stripe");
    expect(appProviders).toContain("stripe-webhook");

    for (const call of appKeyCalls) {
      expect(call.body).toHaveProperty("appId", API_SERVICE_APP_ID);
      expect(call.body).not.toHaveProperty("keySource");
    }
  });

  it("should throw when all env vars are missing", async () => {
    deleteAllEnvVars();
    await expect(registerPlatformKeys()).rejects.toThrow("Missing required env vars");
  });

  it("should throw when key-service returns an error for platform keys", async () => {
    setAllEnvVars();

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, body });

      if (url.includes("/keys")) {
        return new Response(JSON.stringify({ error: "Service unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(registerPlatformKeys()).rejects.toThrow();
  });

  it("should throw when a single env var is missing", async () => {
    setAllEnvVars();
    delete process.env.STRIPE_SECRET_KEY;

    await expect(registerPlatformKeys()).rejects.toThrow("STRIPE_SECRET_KEY");
  });
});
