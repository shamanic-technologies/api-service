import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Keep authenticatePlatform real — this is a staff-only platform route.
vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/middleware/auth.js")>();
  return { ...actual };
});

import adminRoutes from "../../src/routes/admin.js";

const VALID_API_KEY = "test-admin-distribute-key";
const ORG_ID = "org_test_teardown_123";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/internal", adminRoutes);
  return app;
}

const downstreamBody = { deleted: true, orgId: ORG_ID, clerk: "deleted", stripe: "deleted" };

describe("DELETE /internal/admin/orgs/:orgId", () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISTRIBUTE_API_KEY = VALID_API_KEY;
    capturedUrl = undefined;
    capturedInit = undefined;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(downstreamBody),
      };
    });
  });

  it("forwards to client-service DELETE /internal/orgs/:orgId", async () => {
    const app = createApp();
    await request(app).delete(`/internal/admin/orgs/${ORG_ID}`).set("X-API-Key", VALID_API_KEY);

    expect(capturedUrl).toContain(`/internal/orgs/${ORG_ID}`);
    expect(capturedInit?.method).toBe("DELETE");
  });

  it("returns the downstream JSON body + status verbatim on success", async () => {
    const app = createApp();
    const res = await request(app).delete(`/internal/admin/orgs/${ORG_ID}`).set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(downstreamBody);
  });

  it("sends X-API-Key to client-service", async () => {
    const app = createApp();
    await request(app).delete(`/internal/admin/orgs/${ORG_ID}`).set("X-API-Key", VALID_API_KEY);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBeDefined();
  });

  it("rejects requests without platform API key (401)", async () => {
    const app = createApp();
    const res = await request(app).delete(`/internal/admin/orgs/${ORG_ID}`);

    expect(res.status).toBe(401);
  });

  it("propagates an upstream 404 verbatim", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"org not found"}'),
    });

    const app = createApp();
    const res = await request(app).delete(`/internal/admin/orgs/${ORG_ID}`).set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("org not found");
  });

  it("propagates an upstream 500 verbatim (fail loud on partial teardown)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Clerk org deletion failed"),
    });

    const app = createApp();
    const res = await request(app).delete(`/internal/admin/orgs/${ORG_ID}`).set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Clerk org deletion failed");
  });
});
