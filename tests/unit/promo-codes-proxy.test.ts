import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the service client — assert what we forward downstream, return canned bodies.
const { callExternalService } = vi.hoisted(() => ({ callExternalService: vi.fn() }));
vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService,
  externalServices: { billing: { url: "http://billing", apiKey: "k" } },
}));

// authenticatePlatform stays REAL — it is the load-bearing staff gate.
import promoCodesRoutes from "../../src/routes/promo-codes.js";

const VALID_API_KEY = "test-admin-distribute-key";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", promoCodesRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_DISTRIBUTE_API_KEY = VALID_API_KEY;
});

describe("GET /v1/promo-codes/:code", () => {
  it("forwards to billing /internal/promo-codes/:code and returns body byte-identical", async () => {
    const upstream = { code: "welcome", amount_cents: 1000 };
    callExternalService.mockResolvedValueOnce(upstream);

    const res = await request(createApp())
      .get("/v1/promo-codes/welcome")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(callExternalService).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://billing" }),
      "/internal/promo-codes/welcome",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    // No method override on GET
    const opts = callExternalService.mock.calls[0][2];
    expect(opts.method).toBeUndefined();
  });

  it("rejects a caller without the platform API key (401, no downstream call)", async () => {
    const res = await request(createApp()).get("/v1/promo-codes/welcome");
    expect(res.status).toBe(401);
    expect(callExternalService).not.toHaveBeenCalled();
  });

  it("propagates a 404 from billing-service (unknown code)", async () => {
    const err: any = new Error('{"error":"Promo code not found"}');
    err.statusCode = 404;
    callExternalService.mockRejectedValueOnce(err);

    const res = await request(createApp())
      .get("/v1/promo-codes/nope")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /v1/promo-codes/:code", () => {
  it("forwards { amountCents } body byte-identical and returns updated promo code", async () => {
    const upstream = { code: "welcome", amount_cents: 2500 };
    callExternalService.mockResolvedValueOnce(upstream);

    const res = await request(createApp())
      .patch("/v1/promo-codes/welcome")
      .set("X-API-Key", VALID_API_KEY)
      .send({ amountCents: 2500 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(callExternalService).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://billing" }),
      "/internal/promo-codes/welcome",
      expect.objectContaining({ method: "PATCH", body: { amountCents: 2500 } }),
    );
  });

  it("is staff-only — a caller without the platform API key is rejected (401, no downstream write)", async () => {
    const res = await request(createApp())
      .patch("/v1/promo-codes/welcome")
      .send({ amountCents: 999999 });

    expect(res.status).toBe(401);
    expect(callExternalService).not.toHaveBeenCalled();
  });

  it("rejects a wrong platform API key (401)", async () => {
    const res = await request(createApp())
      .patch("/v1/promo-codes/welcome")
      .set("X-API-Key", "wrong-key")
      .send({ amountCents: 999999 });

    expect(res.status).toBe(401);
    expect(callExternalService).not.toHaveBeenCalled();
  });

  it("propagates a 404 from billing-service (unknown code)", async () => {
    const err: any = new Error('{"error":"Promo code not found"}');
    err.statusCode = 404;
    callExternalService.mockRejectedValueOnce(err);

    const res = await request(createApp())
      .patch("/v1/promo-codes/nope")
      .set("X-API-Key", VALID_API_KEY)
      .send({ amountCents: 100 });

    expect(res.status).toBe(404);
  });
});

describe("Promo-codes routes are mounted + registered", () => {
  it("mounts the router in index.ts", () => {
    const fs = require("fs");
    const path = require("path");
    const indexContent = fs.readFileSync(path.join(__dirname, "../../src/index.ts"), "utf-8");
    expect(indexContent).toContain("promoCodesRoutes");
    expect(indexContent).toContain("./routes/promo-codes");
  });

  it("registers both OpenAPI paths with passthrough responses + platform security", () => {
    const fs = require("fs");
    const path = require("path");
    const schemaContent = fs.readFileSync(path.join(__dirname, "../../src/schemas.ts"), "utf-8");
    expect(schemaContent).toContain('path: "/v1/promo-codes/{code}"');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("PromoCodeResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("PromoCodeUpdateResponse")');
    expect(schemaContent).toContain("security: platformAuth");
  });
});
