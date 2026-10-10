import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the routers import.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { FEATURES_BASE };
});

/**
 * Staff agent catalogue — byte passthrough to features-service (PR #1482):
 *   GET /v1/catalogue/<object>      → GET /internal/catalogue/<object>
 *   GET /v1/catalogue/<object>/:id  → GET /internal/catalogue/<object>/:id
 * for steps, sales-paths, channels, pipes, sales-funnels, workflows; and the public
 *   GET /v1/public/catalogue/faces/:file → GET /public/catalogue/faces/:file (an SVG).
 *
 * No auth mock: the real authenticatePlatform + requireStaff run, and every refusal
 * asserts ZERO outbound calls. Bodies are fixtures — features-service owns the shape.
 */
import router, { CATALOGUE_OBJECTS } from "../../src/routes/catalogue-staff.js";
import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use("/v1", featuresRouter);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

const STAFF = { "X-API-Key": "admin-test-key", "x-email": "Kevin@Distribute.you" };
const RAW = '{"object":"pipe","costUnit":"per_outcome","order":"roi_desc","total":1,"truncated":false,"rows":[{"id":"x"}],"someNewField":true}';

let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string, contentType = "application/json; charset=utf-8") {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(raw, { status, headers: { "content-type": contentType } });
  });
}

beforeEach(() => {
  calls = [];
});

it("serves exactly the six objects features-service serves", () => {
  expect([...CATALOGUE_OBJECTS]).toEqual(["steps", "sales-paths", "channels", "pipes", "sales-funnels", "workflows"]);
});

const ROUTES = CATALOGUE_OBJECTS.flatMap((o) => [
  { path: `/v1/catalogue/${o}`, downstream: `${FEATURES_BASE}/internal/catalogue/${o}` },
  { path: `/v1/catalogue/${o}/some-id`, downstream: `${FEATURES_BASE}/internal/catalogue/${o}/some-id` },
]);

for (const r of ROUTES) {
  describe(`staff — GET ${r.path}`, () => {
    it("reaches the exact downstream path with the features key and returns the body byte-for-byte", async () => {
      upstream(200, RAW);
      const res = await request(buildApp()).get(r.path).set(STAFF);
      expect(res.status).toBe(200);
      expect(res.text).toBe(RAW);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(r.downstream);
      expect(calls[0].options.method).toBe("GET");
      expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
      expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
    });

    it("passes a downstream 404 / 503 through with its body", async () => {
      for (const [status, raw] of [
        [404, '{"error":"no pipe x","reason":"pipe_not_found"}'],
        [503, '{"error":"not yet","reason":"catalogue_economics_not_computed_yet"}'],
      ] as const) {
        upstream(status, raw);
        const res = await request(buildApp()).get(r.path).set(STAFF);
        expect(res.status).toBe(status);
        expect(res.body).toEqual(JSON.parse(raw));
      }
    });

    it("refuses the platform key without a staff email (403) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp()).get(r.path).set("X-API-Key", "admin-test-key").set("x-email", "customer@example.com");
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it("refuses a wrong platform key (401) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp()).get(r.path).set("X-API-Key", "nope").set("x-email", "kevin@distribute.you");
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it("refuses a customer bearer key (401) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp()).get(r.path).set("Authorization", "Bearer distrib.usr_customer").set("x-email", "kevin@distribute.you");
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });
  });
}

describe("staff catalogue — query and ids", () => {
  it("forwards the query string verbatim", async () => {
    upstream(200, RAW);
    const q = "?paths=lead_found_to_conversation%2Bconversation_to_paid_client&channels=a,b&limit=25&q=x";
    await request(buildApp()).get(`/v1/catalogue/pipes${q}`).set(STAFF);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/pipes${q}`);
  });

  it("keeps a sales path id's `+` a plus (%2B), never a space", async () => {
    upstream(200, "{}");
    await request(buildApp()).get("/v1/catalogue/sales-paths/a_to_b%2Bb_to_c").set(STAFF);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/sales-paths/a_to_b%2Bb_to_c`);
  });

  it("encodes a pipe id's `|` and forwards a workflow's ?pipe=", async () => {
    upstream(200, "{}");
    await request(buildApp()).get("/v1/catalogue/workflows/osprey?pipe=sales-cold-email-outreach%7Clead_found_to_conversation").set(STAFF);
    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/internal/catalogue/workflows/osprey?pipe=sales-cold-email-outreach%7Clead_found_to_conversation`,
    );
    calls = [];
    upstream(200, "{}");
    await request(buildApp()).get("/v1/catalogue/pipes/sales-cold-email-outreach|lead_found_to_conversation").set(STAFF);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/pipes/sales-cold-email-outreach%7Clead_found_to_conversation`);
  });

  it("encodes a slash-carrying id into one segment", async () => {
    upstream(200, "{}");
    await request(buildApp()).get("/v1/catalogue/steps/a%2Fb").set(STAFF);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/steps/a%2Fb`);
  });

  it("serves no object outside the six", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get("/v1/catalogue/declarations").set(STAFF);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe("public — GET /v1/public/catalogue/faces/:file", () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"></svg>';

  it("pipes the SVG with its content-type and sends no identity", async () => {
    upstream(200, SVG, "image/svg+xml");
    const res = await request(buildApp()).get("/v1/public/catalogue/faces/Victory.svg");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(Buffer.from(res.body ?? res.text).toString()).toBe(SVG);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/catalogue/faces/Victory.svg`);
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
    expect(calls[0].options.headers["x-user-id"]).toBeUndefined();
  });

  it("keeps a two-word name one segment", async () => {
    upstream(200, SVG, "image/svg+xml");
    await request(buildApp()).get("/v1/public/catalogue/faces/Bright%20Dawn.svg");
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/catalogue/faces/Bright%20Dawn.svg`);
  });
});
