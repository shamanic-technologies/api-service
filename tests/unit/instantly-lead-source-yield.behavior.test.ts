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
 * /v1/instantly/ops/lead-source-yield* — staff passthroughs to instantly-service
 * /internal/lead-source-yield*. Real staff gate (no auth mock): drives the router and
 * asserts the forwarded URL, method, body, and the downstream status + bytes back.
 */
import instantlyRouter from "../../src/routes/instantly.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", instantlyRouter);
  return app;
}

const STAFF = { "x-api-key": "platform-test-key", "x-email": "kevin.lourd@gmail.com" };

describe("/v1/instantly/ops/lead-source-yield — over the wire", () => {
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

  it("GET forwards the query string verbatim and returns the downstream bytes", async () => {
    const payload = '{"countingRule":"per_tag","sources":[{"tag":"apollo","bounced":3}],"series":{"days":[]}}';
    stub(200, payload);
    const res = await request(buildApp()).get("/v1/instantly/ops/lead-source-yield?days=30&x=1").set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(payload);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/lead-source-yield?days=30&x=1`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["X-API-Key"]).toBe("instantly-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("GET relays instantly-service's own 400 field-for-field", async () => {
    stub(400, '{"error":"days must be an integer 1..365"}');
    const res = await request(buildApp()).get("/v1/instantly/ops/lead-source-yield?days=0").set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "days must be an integer 1..365" });
  });

  it("POST /sync reaches /internal/lead-source-yield/sync and returns its answer", async () => {
    const payload = '{"missing":4,"stale":0,"batches":1,"asked":4,"inserted":4}';
    stub(200, payload);
    const res = await request(buildApp()).post("/v1/instantly/ops/lead-source-yield/sync").set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(payload);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/lead-source-yield/sync`);
    expect(calls[0].options.method).toBe("POST");
  });
});

describe("/v1/instantly/ops/lead-source-yield — staff gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from a non-staff request");
    });
  });

  const ROUTES: Array<["get" | "post", string]> = [
    ["get", "/v1/instantly/ops/lead-source-yield"],
    ["post", "/v1/instantly/ops/lead-source-yield/sync"],
  ];

  for (const [method, path] of ROUTES) {
    it(`refuses ${method.toUpperCase()} ${path} with no credentials`, async () => {
      const res = await request(buildApp())[method](path);
      expect(res.status).toBe(401);
    });

    it(`refuses ${method.toUpperCase()} ${path} with the platform key but a non-staff email`, async () => {
      const res = await request(buildApp())[method](path)
        .set("x-api-key", "platform-test-key")
        .set("x-email", "someone@customer.example");
      expect(res.status).toBe(403);
    });

    it(`refuses ${method.toUpperCase()} ${path} with a customer Bearer key`, async () => {
      const res = await request(buildApp())[method](path)
        .set("authorization", "Bearer distrib.usr_abc")
        .set("x-email", "kevin.lourd@gmail.com");
      expect([401, 403]).toContain(res.status);
    });
  }
});
