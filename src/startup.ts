import { callExternalService, externalServices } from "./lib/service-client.js";

// ── Platform keys ────────────────────────────────────────────────────────────

const PLATFORM_KEYS: { provider: string; envVar: string }[] = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { provider: "apollo", envVar: "APOLLO_API_KEY" },
  { provider: "instantly", envVar: "INSTANTLY_API_KEY" },
  { provider: "firecrawl", envVar: "FIRECRAWL_API_KEY" },
  { provider: "gemini", envVar: "GEMINI_API_KEY" },
  { provider: "postmark", envVar: "POSTMARK_API_KEY" },
  { provider: "postmark-broadcast-stream", envVar: "POSTMARK_BROADCAST_STREAM_ID" },
  { provider: "postmark-inbound-stream", envVar: "POSTMARK_INBOUND_STREAM_ID" },
  { provider: "postmark-transactional-stream", envVar: "POSTMARK_TRANSACTIONAL_STREAM_ID" },
  { provider: "postmark-from-address", envVar: "POSTMARK_FROM_ADDRESS" },
  { provider: "stripe", envVar: "STRIPE_SECRET_KEY" },
  { provider: "stripe-webhook", envVar: "STRIPE_WEBHOOK_SECRET" },
];

export async function registerPlatformKeys(): Promise<void> {
  console.log("[api-service] Registering platform keys with key-service...");

  // Crash on missing env vars — all keys are required
  const missing = PLATFORM_KEYS.filter(({ envVar }) => !process.env[envVar]);
  if (missing.length > 0) {
    const names = missing.map(({ envVar }) => envVar).join(", ");
    throw new Error(`Missing required env vars: ${names}`);
  }

  for (const { provider, envVar } of PLATFORM_KEYS) {
    const apiKey = process.env[envVar]!;
    await callExternalService(externalServices.key, "/platform-keys", {
      method: "POST",
      body: { provider, apiKey },
    });
    console.log(`[api-service] Platform key registered: ${provider}`);
  }

  console.log(`[api-service] ${PLATFORM_KEYS.length}/${PLATFORM_KEYS.length} platform keys registered successfully`);
}

// ── Email templates ──────────────────────────────────────────────────────────

const LOGO_URL = "https://distribute.you/logo-horizontal.jpg";
const DASHBOARD_URL = "https://dashboard.distribute.you";

function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <img src="${LOGO_URL}" alt="Distribute" style="width:180px;margin-bottom:30px;" />
    ${content}
    <p style="color:#888;font-size:14px;margin-top:40px;padding-top:20px;border-top:1px solid #eee;">
      Distribute — Your AI-powered outreach platform
    </p>
  </div>
</body>
</html>`;
}

const EMAIL_TEMPLATES = [
  // ── Campaign templates (user-facing, branded layout) ───────────────────────
  {
    name: "campaign_created",
    subject: "Campaign created: {{campaignName}}",
    htmlBody: emailLayout(`
      <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:20px;">Campaign created</h1>
      <p style="color:#4a4a4a;font-size:16px;line-height:1.6;margin-bottom:20px;">
        Your campaign <strong>{{campaignName}}</strong> has been created and is now live.
      </p>
      <p style="margin-bottom:20px;">
        <a href="${DASHBOARD_URL}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:16px;">View in dashboard</a>
      </p>`),
    textBody: `Campaign created: {{campaignName}}\n\nYour campaign "{{campaignName}}" has been created and is now live.\n\nView in dashboard: ${DASHBOARD_URL}`,
  },
  {
    name: "campaign_stopped",
    subject: "Campaign stopped: {{campaignName}}",
    htmlBody: emailLayout(`
      <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:20px;">Campaign stopped</h1>
      <p style="color:#4a4a4a;font-size:16px;line-height:1.6;margin-bottom:20px;">
        Your campaign <strong>{{campaignName}}</strong> has been stopped.
      </p>
      <p style="color:#4a4a4a;font-size:16px;line-height:1.6;margin-bottom:20px;">
        You can resume it at any time from your dashboard.
      </p>
      <p style="margin-bottom:20px;">
        <a href="${DASHBOARD_URL}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:16px;">View in dashboard</a>
      </p>`),
    textBody: `Campaign stopped: {{campaignName}}\n\nYour campaign "{{campaignName}}" has been stopped. You can resume it at any time from your dashboard.\n\nView in dashboard: ${DASHBOARD_URL}`,
  },

  // ── User-facing templates (branded layout) ─────────────────────────────────
  {
    name: "waitlist",
    subject: "Welcome to the Distribute Waitlist!",
    htmlBody: emailLayout(`
      <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:20px;">You're on the list!</h1>
      <p style="color:#4a4a4a;font-size:16px;line-height:1.6;margin-bottom:20px;">
        Thanks for joining the Distribute waitlist. We'll notify you as soon as we're ready to launch.
      </p>
      <p style="color:#4a4a4a;font-size:16px;line-height:1.6;margin-bottom:20px;">
        In the meantime, you can:
      </p>
      <ul style="color:#4a4a4a;font-size:16px;line-height:1.8;margin-bottom:30px;">
        <li><a href="https://docs.distribute.you" style="color:#6366f1;">Read the documentation</a></li>
        <li><a href="https://github.com/shamanic-technologies/distribute" style="color:#6366f1;">Star us on GitHub</a></li>
      </ul>`),
    textBody: "You're on the list!\n\nThanks for joining the Distribute waitlist. We'll notify you as soon as we're ready to launch.\n\nIn the meantime, you can:\n- Read the documentation: https://docs.distribute.you\n- Star us on GitHub: https://github.com/shamanic-technologies/distribute",
  },
  {
    name: "welcome",
    subject: "Welcome to Distribute!",
    htmlBody: emailLayout(`
      <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:20px;">Welcome aboard!</h1>
      <p style="color:#4a4a4a;font-size:16px;line-height:1.6;margin-bottom:20px;">
        Your Distribute account is ready. You can now create campaigns, find leads, and automate your outreach.
      </p>
      <p style="color:#4a4a4a;font-size:16px;line-height:1.6;margin-bottom:20px;">
        Get started:
      </p>
      <ul style="color:#4a4a4a;font-size:16px;line-height:1.8;margin-bottom:30px;">
        <li><a href="${DASHBOARD_URL}" style="color:#6366f1;">Open your dashboard</a></li>
        <li><a href="https://docs.distribute.you" style="color:#6366f1;">Read the documentation</a></li>
      </ul>`),
    textBody: `Welcome aboard!\n\nYour Distribute account is ready. You can now create campaigns, find leads, and automate your outreach.\n\nGet started:\n- Open your dashboard: ${DASHBOARD_URL}\n- Read the documentation: https://docs.distribute.you`,
  },

  // ── Admin notification templates (plain, no layout) ────────────────────────
  // Caller must pass { timestamp: new Date().toISOString() } in metadata
  {
    name: "signup_notification",
    subject: "New signup: {{email}}",
    htmlBody: "<p>New user signed up: <strong>{{email}}</strong> at {{timestamp}}</p>",
    textBody: "New user signed up: {{email}} at {{timestamp}}",
  },
  {
    name: "signin_notification",
    subject: "Sign-in: {{email}}",
    htmlBody: "<p>User signed in: <strong>{{email}}</strong> at {{timestamp}}</p>",
    textBody: "User signed in: {{email}} at {{timestamp}}",
  },
  {
    name: "user_active",
    subject: "User active: {{email}}",
    htmlBody: "<p>User is back: <strong>{{email}}</strong> at {{timestamp}}</p>",
    textBody: "User is back: {{email}} at {{timestamp}}",
  },
];

export async function deployEmailTemplates(): Promise<void> {
  console.log("[api-service] Deploying email templates to transactional-email-service...");

  await callExternalService(externalServices.transactionalEmail, "/templates", {
    method: "PUT",
    body: { templates: EMAIL_TEMPLATES },
  });

  console.log(`[api-service] ${EMAIL_TEMPLATES.length} email templates deployed successfully`);
}
