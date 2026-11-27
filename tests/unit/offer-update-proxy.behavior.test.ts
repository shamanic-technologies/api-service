import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BRAND_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { BRAND_BASE };
});

/**
 * PATCH /v1/brands/:id/offers/:offerId (rename an offer or edit its description,
 * OFFER-DESCRIPTION-1127): BEHAVIOURAL cover over the real router with a stubbed fetch.
 * The body reaches brand-service byte-identical, `description: null` included, and
 * brand-service's refusals come back with their status and body.
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

import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "0d3d1f2c-8f4a-4a2e-9d1b-2f0f6a7c5b31";

describe("offer update proxy (rename / edit description)", () => {
  let calls: Array<{ url: string; options: any }>;

  function stub(status: number, body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
    });
  }

  beforeEach(() => {
    calls = [];
  });

  const bodies: Array<Record<string, unknown>> = [
    { description: "Vendors selling to healthcare practices: chiropractors, dentists, physiotherapists." },
    { description: null },
    { name: "Healthcare Practice Vendors", description: "Who it is for now." },
    { name: "Healthcare Practice Vendors" },
  ];

  for (const sent of bodies) {
    it(`forwards ${JSON.stringify(sent)} to brand-service unchanged`, async () => {
      const answer = { offer: { id: OFFER_ID, name: "Healthcare Practice Vendors", description: sent.description ?? null } };
      stub(200, answer);
      const res = await request(buildApp()).patch(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}`).send(sent);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(answer);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}`);
      expect(calls[0].options.method).toBe("PATCH");
      expect(JSON.parse(calls[0].options.body)).toEqual(sent);
      expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
      expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    });
  }

  it("forwards brand-service's 409 name conflict AS a 409 with its body", async () => {
    const refusal = { error: "Another offer on this brand is already named \"Healthcare Practice Vendors\"." };
    stub(409, refusal);
    const res = await request(buildApp())
      .patch(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}`)
      .send({ name: "Healthcare Practice Vendors" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(refusal);
  });

  it("forwards brand-service's 400 (description too long) AS a 400 with its body", async () => {
    const refusal = { error: "description must be at most 500 characters" };
    stub(400, refusal);
    const res = await request(buildApp())
      .patch(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}`)
      .send({ description: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
    expect(JSON.parse(calls[0].options.body).description).toHaveLength(501);
  });
});

describe("offer update in the published document", () => {
  it("documents PATCH /v1/brands/{id}/offers/{offerId} with name and description", async () => {
    const { buildDocument } = await import("../../src/openapi/document.js");
    const doc: any = buildDocument();
    const op = doc.paths["/v1/brands/{id}/offers/{offerId}"]?.patch;
    expect(op).toBeDefined();
    expect(op.summary).toBe("Rename an offer or edit its description");
    expect(op.description).toMatch(/change \/ edit \/ rewrite/);
    const params = (op.parameters ?? []).map((p: any) => p.name ?? p.$ref);
    expect(params).toEqual(expect.arrayContaining(["id", "offerId"]));
    let schema = op.requestBody.content["application/json"].schema;
    if (schema.$ref) schema = doc.components.schemas[schema.$ref.split("/").pop()];
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["name", "description"]));
    expect(schema.properties.description.nullable ?? schema.properties.description.type).toBeTruthy();
  });
});
