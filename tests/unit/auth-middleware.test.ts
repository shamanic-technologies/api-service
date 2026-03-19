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

describe("Auth middleware — admin key via X-API-Key", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISTRIBUTE_API_KEY = ADMIN_KEY;
    app = createApp();
  });

  it("should authenticate with X-API-Key and resolve external IDs via client-service", async () => {
    mockCall.mockResolvedValueOnce({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
      orgCreated: false,
      userCreated: false,
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-external-org-id", "ext_org_123")
      .set("x-external-user-id", "ext_user_456");

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
          externalOrgId: "ext_org_123",
          externalUserId: "ext_user_456",
        },
      },
    );
  });

  it("should forward optional profile headers to POST /resolve", async () => {
    mockCall.mockResolvedValueOnce({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-external-org-id", "ext_org_123")
      .set("x-external-user-id", "ext_user_456")
      .set("x-email", "john@example.com")
      .set("x-first-name", "John")
      .set("x-last-name", "Doe");

    expect(res.status).toBe(200);
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://client-service" }),
      "/resolve",
      {
        method: "POST",
        body: {
          externalOrgId: "ext_org_123",
          externalUserId: "ext_user_456",
          email: "john@example.com",
          firstName: "John",
          lastName: "Doe",
        },
      },
    );
  });

  it("should not include empty profile headers in POST /resolve body", async () => {
    mockCall.mockResolvedValueOnce({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-external-org-id", "ext_org_123")
      .set("x-external-user-id", "ext_user_456");

    expect(res.status).toBe(200);
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://client-service" }),
      "/resolve",
      {
        method: "POST",
        body: {
          externalOrgId: "ext_org_123",
          externalUserId: "ext_user_456",
        },
      },
    );
  });

  it("should return 400 when x-external-org-id is missing", async () => {
    const res = await request(app)
      .get("/v1/workflows")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-external-user-id", "ext_user_456");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Admin auth requires both x-external-org-id and x-external-user-id");
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("should return 400 when x-external-user-id is missing", async () => {
    const res = await request(app)
      .get("/v1/workflows")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-external-org-id", "ext_org_123");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Admin auth requires both x-external-org-id and x-external-user-id");
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("should return 400 when both external ID headers are missing", async () => {
    const res = await request(app)
      .get("/v1/me")
      .set("X-API-Key", ADMIN_KEY);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Admin auth requires both x-external-org-id and x-external-user-id");
  });

  it("should return 401 when X-API-Key does not match admin key", async () => {
    const res = await request(app)
      .get("/v1/me")
      .set("X-API-Key", "wrong-key")
      .set("x-external-org-id", "ext_org_123")
      .set("x-external-user-id", "ext_user_456");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid admin key");
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("should return 502 when client-service resolution fails", async () => {
    mockCall.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await request(app)
      .get("/v1/workflows")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-external-org-id", "ext_org_123")
      .set("x-external-user-id", "ext_user_456");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Identity resolution failed");
  });

  it("should no longer accept admin key via Bearer token", async () => {
    mockCall.mockResolvedValueOnce({ valid: false });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", `Bearer ${ADMIN_KEY}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid API key");
  });
});

describe("Auth middleware — user key via Bearer", () => {
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

  it("should return 401 when no authentication header is present", async () => {
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

describe("Auth middleware — run creation is mandatory", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISTRIBUTE_API_KEY = ADMIN_KEY;
    app = createApp();
  });

  it("should return 502 when createRun fails (runs-service down)", async () => {
    const { createRun } = await import("@distribute/runs-client");
    vi.mocked(createRun).mockRejectedValueOnce(new Error("Connection refused"));

    // User key auth succeeds
    mockCall.mockResolvedValueOnce({
      valid: true,
      orgId: "org-uuid-direct",
      userId: "user-uuid-direct",
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_usr_test123");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Run tracking unavailable");
  });

  it("should forward x-brand-id, x-campaign-id, x-workflow-name headers to createRun", async () => {
    const { createRun } = await import("@distribute/runs-client");
    const mockCreateRun = vi.mocked(createRun);
    mockCreateRun.mockResolvedValueOnce({ id: "run-with-context" } as never);

    mockCall.mockResolvedValueOnce({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-external-org-id", "ext_org_123")
      .set("x-external-user-id", "ext_user_456")
      .set("x-brand-id", "brand-abc")
      .set("x-campaign-id", "campaign-xyz")
      .set("x-workflow-name", "my-workflow");

    expect(res.status).toBe(200);
    expect(mockCreateRun).toHaveBeenCalledWith(
      {
        orgId: "org-uuid-123",
        userId: "user-uuid-456",
        serviceName: "api-service",
        taskName: "GET /v1/workflows",
      },
      {
        "x-brand-id": "brand-abc",
        "x-campaign-id": "campaign-xyz",
        "x-workflow-name": "my-workflow",
      },
    );
  });

  it("should not include tracking headers when none are provided", async () => {
    const { createRun } = await import("@distribute/runs-client");
    const mockCreateRun = vi.mocked(createRun);
    mockCreateRun.mockResolvedValueOnce({ id: "run-no-context" } as never);

    mockCall.mockResolvedValueOnce({
      valid: true,
      orgId: "org-uuid-direct",
      userId: "user-uuid-direct",
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_usr_test123");

    expect(res.status).toBe(200);
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-uuid-direct" }),
      {},
    );
  });

  it("should return 502 when createRun fails for admin auth too", async () => {
    const { createRun } = await import("@distribute/runs-client");
    vi.mocked(createRun).mockRejectedValueOnce(new Error("Connection refused"));

    // Admin auth with identity resolution succeeds
    mockCall.mockResolvedValueOnce({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("X-API-Key", ADMIN_KEY)
      .set("x-external-org-id", "ext_org_123")
      .set("x-external-user-id", "ext_user_456");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Run tracking unavailable");
  });
});
