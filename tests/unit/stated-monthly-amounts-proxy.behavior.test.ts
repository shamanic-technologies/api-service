import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { FEATURES_BASE };
});

/**
 * /v1/features/stated-monthly-amounts — BEHAVIOURAL cover for the staff CRUD proxy.
 *
 * A source-substring test cannot see what goes over the wire (CLAUDE.md rule #7,
 * corollary 3), and everything this route owes its caller IS what goes over the wire:
 * the downstream path, the body forwarded verbatim, the query string forwarded
 * verbatim, and features-service's own status AND body coming back field-for-field —
 * above all the 409 whose `reason` names the range the write collided with.
 *
 * The real staff gate runs here (no auth mock): the platform key + a staff x-email are
 * what the requests below carry. `stated-monthly-amounts-auth.test.ts` covers refusal.
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const STAFF = {
  "x-api-key": "platform-test-key",
  "x-email": "kevin.lourd@gmail.com",
};

const ID = "6c9a6c2e-6c1f-4b0a-9a3e-2f7c1b4d5e6f";

// A fixture, not a contract this repo owns — features-service names these fields.
const ROW = {
  id: ID,
  orgId: "2c2c1c9f-9a7b-4a0b-8b2f-8d2a3a4b5c6d",
  brandId: "4e4e3ebb-bbc9-4c2d-8d4b-af4c5c6d7e8f",
  amountUsd: 4000,
  startDate: "2026-01-01",
  endDate: null,
  note: "signed at 4k/mo",
};

describe("/v1/features/stated-monthly-amounts — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stub(status: number, body: string | null, contentType = "application/json") {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return new Response(body, {
        status,
        headers: body === null ? {} : { "content-type": contentType },
      });
    });
  }

  beforeEach(() => {
    calls = [];
    stub(200, JSON.stringify({ statedAmounts: [ROW] }));
  });

  it("lists through features-service's own path, carrying the verified staff email", async () => {
    const res = await request(buildApp()).get("/v1/features/stated-monthly-amounts").set(STAFF);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/stated-monthly-amounts`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
    // Platform-wide staff data: no org identity is involved on this surface.
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
    expect(calls[0].options.headers["x-user-id"]).toBeUndefined();
    expect(res.body).toEqual({ statedAmounts: [ROW] });
  });

  it("forwards the caller's query string verbatim, including a filter this gateway never declared", async () => {
    await request(buildApp())
      .get(`/v1/features/stated-monthly-amounts?orgId=${ROW.orgId}&brandId=${ROW.brandId}&somethingNew=42`)
      .set(STAFF);

    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/internal/stated-monthly-amounts?orgId=${ROW.orgId}&brandId=${ROW.brandId}&somethingNew=42`,
    );
  });

  it("creates with the body byte-identical and answers the upstream 201 and row", async () => {
    stub(201, JSON.stringify({ statedAmount: ROW }));
    const body = {
      orgId: ROW.orgId,
      brandId: ROW.brandId,
      amountUsd: 4000,
      startDate: "2026-01-01",
      endDate: null,
      note: "signed at 4k/mo",
      // A field this gateway declares nowhere must still reach the downstream.
      undeclaredByTheGateway: "survives",
    };

    const res = await request(buildApp()).post("/v1/features/stated-monthly-amounts").set(STAFF).send(body);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/stated-monthly-amounts`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ statedAmount: ROW });
  });

  it("patches one row by id, forwarding an explicit null rather than dropping the key", async () => {
    stub(200, JSON.stringify({ statedAmount: { ...ROW, endDate: null } }));

    const res = await request(buildApp())
      .patch(`/v1/features/stated-monthly-amounts/${ID}`)
      .set(STAFF)
      .send({ endDate: null });

    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/stated-monthly-amounts/${ID}`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ endDate: null });
    expect(res.status).toBe(200);
  });

  it("deletes one row by id and answers the upstream 204 with no body", async () => {
    stub(204, null);

    const res = await request(buildApp()).delete(`/v1/features/stated-monthly-amounts/${ID}`).set(STAFF);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/stated-monthly-amounts/${ID}`);
    expect(calls[0].options.method).toBe("DELETE");
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("hands back the 409 conflict with its reason intact, not flattened into one error string", async () => {
    const conflict = {
      error: "stated_amount_conflict",
      reason: "2026-01-01 → open overlaps the stated amount in force from 2025-06-01 to 2026-03-31",
    };
    stub(409, JSON.stringify(conflict));

    const res = await request(buildApp())
      .post("/v1/features/stated-monthly-amounts")
      .set(STAFF)
      .send({ orgId: ROW.orgId, brandId: ROW.brandId, amountUsd: 4000 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(conflict);
  });

  it("hands back the 404 for an unknown id unchanged", async () => {
    stub(404, JSON.stringify({ error: "stated_amount_not_found" }));

    const res = await request(buildApp()).delete(`/v1/features/stated-monthly-amounts/${ID}`).set(STAFF);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "stated_amount_not_found" });
  });

  it("does not let the literal segment be swallowed by /features/:slug", async () => {
    // Express matches a path parameter against any single segment, so the literal must be
    // declared first or the list request would be served as a slug lookup.
    await request(buildApp()).get("/v1/features/stated-monthly-amounts").set(STAFF);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/stated-monthly-amounts`);
    expect(calls[0].url).not.toContain("pipeline-activity");
  });
});
