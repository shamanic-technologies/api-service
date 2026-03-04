import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../../src/middleware/auth.js";

// Mock runs-client (auth middleware creates a run on every authenticated request)
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "mock-run-id" }),
  updateRun: vi.fn().mockResolvedValue({ id: "mock-run-id", status: "completed" }),
}));

// Mock callExternalService for both key-service /validate and client-service /resolve
vi.mock("../../src/lib/service-client.js", () => {
  const mockCallExternalService = vi.fn();
  return {
    callExternalService: mockCallExternalService,
    externalServices: {
      key: { url: "http://key-service", apiKey: "test-service-key" },
      client: { url: "http://client-service", apiKey: "test" },
    },
  };
});

import { callExternalService } from "../../src/lib/service-client.js";
const mockCall = vi.mocked(callExternalService);

const ADMIN_KEY = "test-admin-distribute-key";

function createApp() {
  const app = express();
  app.use(express.json());

  // Endpoint that requires org + user
  app.get(
    "/v1/workflows",
    authenticate,
    requireOrg,
    requireUser,
    (req: AuthenticatedRequest, res) => {
      res.json({ orgId: req.orgId, userId: req.userId, authType: req.authType });
    },
  );

  // Endpoint that only requires auth (no requireOrg)
  app.get("/v1/me", authenticate, (req: AuthenticatedRequest, res) => {
    res.json({ orgId: req.orgId || null, userId: req.userId || null, authType: req.authType });
  });

  return app;
}

describe("Auth middleware — admin key", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISTRIBUTE_API_KEY = ADMIN_KEY;
    app = createApp();
  });

  it("should authenticate with admin key and resolve external IDs via client-service", async () => {
    mockCall.mockResolvedValueOnce({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
      orgCreated: false,
      userCreated: false,
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .set("x-org-id", "org_2clerkOrg")
      .set("x-user-id", "user_2clerkUser");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
      authType: "admin",
    });

    // Only client-service /resolve called — NO key-service /validate
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://client-service" }),
      "/resolve",
      {
        method: "POST",
        body: {
          externalOrgId: "org_2clerkOrg",
          externalUserId: "user_2clerkUser",
        },
      },
    );
  });

  it("should allow admin key without org/user headers (admin-only access)", async () => {
    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", `Bearer ${ADMIN_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orgId: null, userId: null, authType: "admin" });
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("should return 502 when client-service resolution fails for admin key", async () => {
    mockCall.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .set("x-org-id", "org_2clerkOrg")
      .set("x-user-id", "user_2clerkUser");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Identity resolution failed");
  });

  it("should return 401 when Bearer token does not match admin key and key-service rejects it", async () => {
    mockCall.mockResolvedValueOnce({ valid: false });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer wrong-key");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid API key");
  });
});

describe("Auth middleware — user key", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISTRIBUTE_API_KEY = ADMIN_KEY;
    app = createApp();
  });

  it("should set orgId, userId from key-service without client-service call", async () => {
    mockCall.mockResolvedValueOnce({
      valid: true,
      orgId: "org-uuid-direct",
      userId: "user-uuid-direct",
    });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_usr_test123");

    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe("org-uuid-direct");
    expect(res.body.authType).toBe("user_key");
    // Only one callExternalService call for /validate, none for /resolve
    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it("should pass requireOrg and requireUser when user key carries full identity", async () => {
    mockCall.mockResolvedValueOnce({
      valid: true,
      orgId: "org-uuid-direct",
      userId: "user-uuid-direct",
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_usr_test123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orgId: "org-uuid-direct",
      userId: "user-uuid-direct",
      authType: "user_key",
    });
    expect(mockCall).toHaveBeenCalledTimes(1);
  });
});

describe("Auth middleware — error cases", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISTRIBUTE_API_KEY = ADMIN_KEY;
    app = createApp();
  });

  it("should return 401 when no Authorization header", async () => {
    const res = await request(app).get("/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication");
  });

  it("should return 401 when key-service returns valid:false", async () => {
    mockCall.mockResolvedValueOnce({ valid: false });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_invalid");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid API key");
  });

  it("should return 401 when key-service call fails", async () => {
    mockCall.mockRejectedValueOnce(new Error("Service call failed: 401"));

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_invalid");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid API key");
    expect(mockCall).toHaveBeenCalledTimes(1);
  });
});
