import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * SECRETS-ROTATE-1127 (forensics FORENSICS-1127): routes gated by the platform key alone were
 * reachable by any signed-in customer through the dashboard proxy, which injects that key.
 * Promo-code re-pricing and any org's run events are staff only now.
 */
import promoCodesRoutes from "../../src/routes/promo-codes.js";
import runsRoutes from "../../src/routes/runs.js";

const PLATFORM_KEY = "secrets-rotate-staff-reads-key";
const CUSTOMER = { "x-email": "attacker@example.com", "x-external-user-id": "user_attacker", "x-external-org-id": "org_attacker" };

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", promoCodesRoutes);
  a.use("/v1", runsRoutes);
  return a;
}

beforeAll(() => {
  process.env.ADMIN_DISTRIBUTE_API_KEY = PLATFORM_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const RUN = "11111111-1111-4111-8111-111111111111";

describe("platform key + a customer session is refused 403", () => {
  const cases: Array<["get" | "patch", string]> = [
    ["get", "/v1/promo-codes/welcome"],
    ["patch", "/v1/promo-codes/welcome"],
    ["get", `/v1/runs/${RUN}/events`],
    ["get", `/v1/runs/${RUN}/events/stream`],
  ];
  for (const [method, path] of cases) {
    it(`${method.toUpperCase()} ${path}`, async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockClear();
      const res = await request(app())[method](path).set("x-api-key", PLATFORM_KEY).set(CUSTOMER).send({ amountCents: 999999 });
      expect(res.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it("staff still re-prices the welcome credit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "welcome", amountCents: 500 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const res = await request(app())
      .patch("/v1/promo-codes/welcome")
      .set("x-api-key", PLATFORM_KEY)
      .set("x-email", "kevin@distribute.you")
      .send({ amountCents: 500 });
    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/internal/promo-codes/welcome");
  });
});
