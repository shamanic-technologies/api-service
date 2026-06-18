import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.brandId = "brand_testabc";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const PERSONA_ID = "22222222-2222-4222-8222-222222222222";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

let capturedUrl: string | undefined;
let capturedInit: RequestInit | undefined;

function mockUpstream(status: number, payload: unknown, ok = status < 400) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return ok
      ? { ok: true, status, json: () => Promise.resolve(payload) }
      : { ok: false, status, text: () => Promise.resolve(JSON.stringify(payload)) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUrl = undefined;
  capturedInit = undefined;
});

const personasPayload = {
  personas: [{ id: PERSONA_ID, name: "Eco shopper", status: "active", avatarUrl: "https://cdn.example.com/persona.png" }],
};
const personaPayload = { persona: { id: PERSONA_ID, name: "Eco shopper", status: "active", avatarUrl: null } };
const profilePayload = { brandProfile: { id: "prof_1", version: 3 } };

describe("GET /v1/brands/:id/personas", () => {
  it("forwards to brand-service GET /orgs/brands/:id/personas and returns payload + status verbatim", async () => {
    mockUpstream(200, personasPayload);
    const app = buildApp();
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/personas`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(personasPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/personas`);
    expect(capturedInit?.method ?? "GET").toBe("GET");
  });

  it("forwards the raw query string verbatim", async () => {
    mockUpstream(200, personasPayload);
    const app = buildApp();
    await request(app).get(`/v1/brands/${BRAND_ID}/personas?status=active&sort=name`);

    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/personas?status=active&sort=name`);
  });

  it("forwards identity headers (x-org-id, x-user-id, x-run-id)", async () => {
    mockUpstream(200, personasPayload);
    const app = buildApp();
    await request(app).get(`/v1/brands/${BRAND_ID}/personas`);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it("propagates an upstream 404 status + body verbatim", async () => {
    mockUpstream(404, { error: "Brand not found" });
    const app = buildApp();
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/personas`);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Brand not found");
  });
});

describe("POST /v1/brands/:id/personas", () => {
  const body = { name: "Eco shopper", description: "Buys sustainable goods" };

  it("forwards body byte-identical and returns 201 verbatim on create", async () => {
    mockUpstream(201, personaPayload);
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/personas`).send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(personaPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/personas`);
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
  });

  it("propagates an upstream 400 validation error verbatim", async () => {
    mockUpstream(400, { error: "name is required" });
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/personas`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("name is required");
  });
});

describe("POST /v1/brands/:id/personas/suggest", () => {
  const body = { count: 3 };
  const suggestPayload = { personas: [{ name: "Eco shopper", filters: { interest: "sustainability" } }] };

  it("forwards body byte-identical to the suggest path and returns payload + status verbatim", async () => {
    mockUpstream(200, suggestPayload);
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/personas/suggest`).send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(suggestPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/personas/suggest`);
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
  });

  it("propagates an upstream error verbatim", async () => {
    mockUpstream(404, { error: "brand not found" });
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/personas/suggest`).send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("brand not found");
  });
});

describe("POST /v1/brands/:id/icp/suggest", () => {
  const icpPayload = { icp: "B2B SaaS founders at 10-50 person startups looking to scale outbound" };

  it("forwards to brand-service /orgs/brands/:id/icp/suggest and returns { icp } + status verbatim", async () => {
    mockUpstream(200, icpPayload);
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/icp/suggest`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(icpPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/icp/suggest`);
    expect(capturedInit?.method).toBe("POST");
  });

  it("forwards { existingIcps } body byte-identical to downstream", async () => {
    mockUpstream(200, icpPayload);
    const app = buildApp();
    const body = { existingIcps: ["Solo founders", "Marketing agencies"] };
    await request(app).post(`/v1/brands/${BRAND_ID}/icp/suggest`).send(body);

    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
  });

  it("forwards identity headers (x-org-id, x-user-id, x-run-id)", async () => {
    mockUpstream(200, icpPayload);
    const app = buildApp();
    await request(app).post(`/v1/brands/${BRAND_ID}/icp/suggest`).send({});

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it.each([
    [402, { error: "Insufficient credits" }, "Insufficient credits"],
    [422, { error: "Brand profile is empty" }, "Brand profile is empty"],
    [404, { error: "Brand not found" }, "Brand not found"],
    [400, { error: "existingIcps must be an array of strings" }, "existingIcps must be an array"],
  ])("propagates upstream %i status + body verbatim", async (status, payload, expected) => {
    mockUpstream(status, payload);
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/icp/suggest`).send({});

    expect(res.status).toBe(status);
    expect(res.body.error).toContain(expected);
  });
});

describe("POST /v1/brands/:id/personas/:personaId/duplicate", () => {
  it("forwards to the duplicate path and returns 201 verbatim", async () => {
    mockUpstream(201, personaPayload);
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/personas/${PERSONA_ID}/duplicate`).send({});

    expect(res.status).toBe(201);
    expect(res.body).toEqual(personaPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/personas/${PERSONA_ID}/duplicate`);
    expect(capturedInit?.method).toBe("POST");
  });
});

describe("POST /v1/brands/:id/personas/:personaId/avatar/regenerate", () => {
  const regeneratedPayload = {
    persona: {
      id: PERSONA_ID,
      name: "Eco shopper",
      status: "active",
      avatarUrl: "https://cdn.example.com/persona-regenerated.png",
    },
  };

  it("forwards empty body to the avatar regenerate path and returns payload + status verbatim", async () => {
    mockUpstream(200, regeneratedPayload);
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/personas/${PERSONA_ID}/avatar/regenerate`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(regeneratedPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/personas/${PERSONA_ID}/avatar/regenerate`);
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual({});
  });

  it("propagates an upstream avatar regeneration error verbatim", async () => {
    mockUpstream(404, { error: "persona not found" });
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/personas/${PERSONA_ID}/avatar/regenerate`).send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("persona not found");
  });
});

describe("PATCH /v1/brands/:id/personas/:personaId/status", () => {
  const body = { status: "archived" };

  it("forwards body to the status path and returns payload + status verbatim", async () => {
    mockUpstream(200, personaPayload);
    const app = buildApp();
    const res = await request(app).patch(`/v1/brands/${BRAND_ID}/personas/${PERSONA_ID}/status`).send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(personaPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/personas/${PERSONA_ID}/status`);
    expect(capturedInit?.method).toBe("PATCH");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
  });
});

describe("GET /v1/brands/:id/brand-profile", () => {
  it("forwards to brand-service GET /orgs/brands/:id/brand-profile and returns payload + status verbatim", async () => {
    mockUpstream(200, profilePayload);
    const app = buildApp();
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/brand-profile`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(profilePayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/brand-profile`);
    expect(capturedInit?.method ?? "GET").toBe("GET");
  });
});

describe("POST /v1/brands/:id/brand-profile", () => {
  const body = { tone: "playful", values: ["sustainability"] };

  it("forwards body byte-identical and returns 201 verbatim on create", async () => {
    mockUpstream(201, profilePayload);
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/brand-profile`).send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(profilePayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/brand-profile`);
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
  });

  it("propagates an upstream 409 conflict status + body verbatim", async () => {
    mockUpstream(409, { error: "A brand profile already exists for this brand" });
    const app = buildApp();
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/brand-profile`).send(body);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already exists");
  });
});
