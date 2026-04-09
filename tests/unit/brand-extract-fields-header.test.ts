import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../../src/middleware/auth.js";

vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "mock-run-id" }),
  updateRun: vi.fn().mockResolvedValue({ id: "mock-run-id", status: "completed" }),
}));

vi.mock("../../src/lib/service-client.js", () => {
  const mockCallExternalService = vi.fn();
  return {
    callExternalService: mockCallExternalService,
    externalServices: {
      key: { url: "http://key-service", apiKey: "test-service-key" },
      client: { url: "http://client-service", apiKey: "test" },
      brand: { url: "http://brand-service", apiKey: "test-brand-key" },
    },
  };
});

import { callExternalService } from "../../src/lib/service-client.js";
const mockCall = vi.mocked(callExternalService);

const ADMIN_KEY = "test-admin-distribute-key";

function createApp() {
  const app = express();
  app.use(express.json());

  // Import brand routes
  // Use inline route to test header parsing
  app.post(
    "/v1/brands/extract-fields",
    authenticate,
    requireOrg,
    requireUser,
    (req: AuthenticatedRequest, res) => {
      if (!req.brandId) {
        return res.status(400).json({ error: "x-brand-id header is required" });
      }
      // Return the parsed brandId so we can verify CSV forwarding
      res.json({ brandId: req.brandId });
    },
  );

  return app;
}

describe("POST /v1/brands/extract-fields — multi-brand header", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISTRIBUTE_API_KEY = ADMIN_KEY;
    app = createApp();
  });

  it("should accept a single brand UUID in x-brand-id", async () => {
    const res = await request(app)
      .post("/v1/brands/extract-fields")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-org-id", "org-uuid-1")
      .set("x-user-id", "user-uuid-1")
      .set("x-brand-id", "brand-uuid-1")
      .send({ fields: [{ key: "industry", description: "Primary industry" }] });

    expect(res.status).toBe(200);
    expect(res.body.brandId).toBe("brand-uuid-1");
  });

  it("should accept comma-separated brand UUIDs in x-brand-id", async () => {
    const res = await request(app)
      .post("/v1/brands/extract-fields")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-org-id", "org-uuid-1")
      .set("x-user-id", "user-uuid-1")
      .set("x-brand-id", "brand-uuid-1,brand-uuid-2,brand-uuid-3")
      .send({ fields: [{ key: "industry", description: "Primary industry" }] });

    expect(res.status).toBe(200);
    expect(res.body.brandId).toBe("brand-uuid-1,brand-uuid-2,brand-uuid-3");
  });

  it("should return 400 when x-brand-id header is missing", async () => {
    const res = await request(app)
      .post("/v1/brands/extract-fields")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-org-id", "org-uuid-1")
      .set("x-user-id", "user-uuid-1")
      .send({ fields: [{ key: "industry", description: "Primary industry" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("x-brand-id header is required");
  });
});

describe("auth middleware — x-brand-id CSV forwarding", () => {
  it("should store CSV x-brand-id value on req.brandId", async () => {
    const app = express();
    app.use(express.json());

    let capturedBrandId: string | undefined;
    app.get(
      "/test",
      authenticate,
      (req: AuthenticatedRequest, res) => {
        capturedBrandId = req.brandId;
        res.json({ ok: true });
      },
    );

    process.env.ADMIN_DISTRIBUTE_API_KEY = ADMIN_KEY;

    await request(app)
      .get("/test")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-org-id", "org-uuid-1")
      .set("x-user-id", "user-uuid-1")
      .set("x-brand-id", "brand-1,brand-2");

    expect(capturedBrandId).toBe("brand-1,brand-2");
  });
});

describe("buildInternalHeaders — CSV x-brand-id forwarding", () => {
  it("should forward CSV brand ID value as-is in x-brand-id header", async () => {
    // Read the source to verify buildInternalHeaders forwards brandId via IDENTITY_QUERY_MAP
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/lib/internal-headers.ts"),
      "utf-8",
    );
    // brandId is forwarded as x-brand-id via the IDENTITY_QUERY_MAP loop
    expect(src).toContain('["x-brand-id", "brandId", "brandId"]');
  });
});
