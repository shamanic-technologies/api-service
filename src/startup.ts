import { callExternalService, externalServices } from "./lib/service-client.js";

export const API_SERVICE_APP_ID = "api-service";

const PLATFORM_KEYS: { provider: string; envVar: string }[] = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { provider: "apollo", envVar: "APOLLO_API_KEY" },
  { provider: "instantly", envVar: "INSTANTLY_API_KEY" },
  { provider: "firecrawl", envVar: "FIRECRAWL_API_KEY" },
  { provider: "gemini", envVar: "GEMINI_API_KEY" },
  { provider: "postmark", envVar: "POSTMARK_API_KEY" },
];

/** Keys registered as app-level keys so downstream services can resolve them by appId */
const APP_KEYS: { provider: string; envVar: string }[] = [
  { provider: "stripe", envVar: "STRIPE_SECRET_KEY" },
  { provider: "stripe-webhook", envVar: "STRIPE_WEBHOOK_SECRET" },
];

const ALL_KEYS = [...PLATFORM_KEYS, ...APP_KEYS];

export async function registerPlatformKeys(): Promise<void> {
  console.log("[api-service] Registering platform keys with key-service...");

  // Crash on missing env vars — all keys are required
  const missing = ALL_KEYS.filter(({ envVar }) => !process.env[envVar]);
  if (missing.length > 0) {
    const names = missing.map(({ envVar }) => envVar).join(", ");
    throw new Error(`Missing required env vars: ${names}`);
  }

  for (const { provider, envVar } of PLATFORM_KEYS) {
    const apiKey = process.env[envVar]!;
    await callExternalService(externalServices.key, "/keys", {
      method: "POST",
      body: { keySource: "platform", provider, apiKey },
    });
    console.log(`[api-service] Platform key registered: ${provider}`);
  }

  for (const { provider, envVar } of APP_KEYS) {
    const apiKey = process.env[envVar]!;
    await callExternalService(externalServices.key, "/internal/app-keys", {
      method: "POST",
      body: { appId: API_SERVICE_APP_ID, provider, apiKey },
    });
    console.log(`[api-service] App key registered: ${provider}`);
  }

  console.log(`[api-service] ${ALL_KEYS.length}/${ALL_KEYS.length} keys registered successfully`);
}
