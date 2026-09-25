import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BRAND_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { BRAND_BASE };
});

/**
 * Leg rates + per-offer economics — behavioural cover (CLAUDE.md #7 corollaries 2/3):
 * drive the real brand router, assert the FULL forwarded URL, the authenticated org,
 * and the byte-identical body both ways. Payloads are fixtures, not a contract here.
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = "22222222-2222-4222-8222-222222222222";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

let calls: Array<{ url: string; options: any }>;

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    if (status >= 200 && status < 300) {
      return { ok: true, status, json: () => Promise.resolve(body) };
    }
    return { ok: false, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) };
  });
}

const UPSTREAM = { brandId: BRAND_ID, anything: [{ legKey: "reply_meeting", pct: 30 }], extra: null };

beforeEach(() => {
  calls = [];
  stubFetch(200, UPSTREAM);
});

const cases = [
  { name: "leg-rates", path: `/v1/brands/${BRAND_ID}/leg-rates`, downstream: `/orgs/brands/${BRAND_ID}/leg-rates` },
  {
    name: "offer economics",
    path: `/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/economics`,
    downstream: `/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/economics`,
  },
];

for (const c of cases) {
  describe(`${c.name} proxy — over the wire`, () => {
    it("GET forwards to brand-service's real path with the authenticated org, body untouched", async () => {
      const res = await request(buildApp()).get(c.path).set("x-org-id", "someone-elses-org");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(UPSTREAM);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${BRAND_BASE}${c.downstream}`);
      expect(calls[0].options.method).toBe("GET");
      expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
      expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    });

    it("PUT forwards the body byte-identical and returns the downstream body", async () => {
      const body = { legs: [{ legKey: "reply_meeting", pct: 30 }], unknownField: "kept" };
      const res = await request(buildApp()).put(c.path).send(body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(UPSTREAM);
      expect(calls[0].url).toBe(`${BRAND_BASE}${c.downstream}`);
      expect(calls[0].options.method).toBe("PUT");
      expect(JSON.parse(calls[0].options.body)).toEqual(body);
    });

    it("forwards a downstream 400 with status and body intact", async () => {
      stubFetch(400, { error: "bad leg", code: "UNKNOWN_LEG" });
      const res = await request(buildApp()).put(c.path).send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "bad leg", code: "UNKNOWN_LEG" });
    });
  });
}
