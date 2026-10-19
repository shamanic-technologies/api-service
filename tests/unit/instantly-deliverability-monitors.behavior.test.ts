import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { INSTANTLY_BASE } = vi.hoisted(() => {
  const INSTANTLY_BASE = "http://instantly.test.local";
  process.env.INSTANTLY_SERVICE_URL = INSTANTLY_BASE;
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { INSTANTLY_BASE };
});

/**
 * /v1/instantly/ops/seed-placement/daily and /v1/instantly/ops/sender-health — staff
 * passthroughs to instantly-service's deliverability monitors. Real staff gate (no auth
 * mock): asserts the forwarded URL, method, and the downstream status + bytes back.
 */
import instantlyRouter from "../../src/routes/instantly.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", instantlyRouter);
  return app;
}

const STAFF = { "x-api-key": "platform-test-key", "x-email": "kevin.lourd@gmail.com" };

describe("deliverability monitors — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stub(status: number, body: string) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => {
    calls = [];
  });

  it("GET seed-placement/daily reaches /internal/seed-placement/daily with the query verbatim", async () => {
    const payload = '{"asOf":"2026-10-19T00:00:00.000Z","from":"2026-10-01","to":"2026-10-19","days":[]}';
    stub(200, payload);
    const res = await request(buildApp()).get("/v1/instantly/ops/seed-placement/daily?from=2026-10-01").set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(payload);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/seed-placement/daily?from=2026-10-01`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("instantly-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("GET sender-health reaches /internal/sender-health with days forwarded", async () => {
    const payload = '{"asOf":"2026-10-19T00:00:00.000Z","from":"2026-09-20","to":"2026-10-19","current":null,"days":[]}';
    stub(200, payload);
    const res = await request(buildApp()).get("/v1/instantly/ops/sender-health?days=30").set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(payload);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/sender-health?days=30`);
    expect(calls[0].options.method).toBe("GET");
  });

  it("GET sender-health relays instantly-service's own 400", async () => {
    stub(400, '{"error":"Bad days"}');
    const res = await request(buildApp()).get("/v1/instantly/ops/sender-health?days=0").set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Bad days" });
  });
});

describe("deliverability monitors — staff gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from a non-staff request");
    });
  });

  for (const path of ["/v1/instantly/ops/seed-placement/daily", "/v1/instantly/ops/sender-health"]) {
    it(`refuses GET ${path} with no credentials`, async () => {
      const res = await request(buildApp()).get(path);
      expect(res.status).toBe(401);
    });

    it(`refuses GET ${path} with the platform key but a non-staff email`, async () => {
      const res = await request(buildApp())
        .get(path)
        .set("x-api-key", "platform-test-key")
        .set("x-email", "someone@customer.example");
      expect(res.status).toBe(403);
    });
  }
});
