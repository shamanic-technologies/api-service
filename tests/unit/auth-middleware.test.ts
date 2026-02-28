import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../../src/middleware/auth.js";

// Mock the service-client module
vi.mock("../../src/lib/service-client.js", () => {
  const mockCallExternalService = vi.fn();
  return {
    callExternalService: mockCallExternalService,
    externalServices: {
      key: { url: "http://key-service", apiKey: "test" },
      client: { url: "http://client-service", apiKey: "test" },
    },
  };
});

import { callExternalService } from "../../src/lib/service-client.js";
const mockCall = vi.mocked(callExternalService);

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

describe("Auth middleware — app key with identity headers", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("should resolve external IDs to internal UUIDs via client-service", async () => {
    // key-service validates the app key
    mockCall.mockResolvedValueOnce({ valid: true, type: "app", appId: "test-app" });
    // client-service resolves external IDs
    mockCall.mockResolvedValueOnce({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
      orgCreated: false,
      userCreated: false,
    });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_app_test123")
      .set("x-org-id", "org_2clerkOrg")
      .set("x-user-id", "user_2clerkUser");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orgId: "org-uuid-123",
      userId: "user-uuid-456",
      authType: "app_key",
    });

    // Verify client-service was called with correct body
    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(mockCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: "http://client-service" }),
      "/resolve",
      {
        method: "POST",
        body: {
          appId: "test-app",
          externalOrgId: "org_2clerkOrg",
          externalUserId: "user_2clerkUser",
        },
      },
    );
  });

  it("should return 400 from requireOrg when identity headers are missing", async () => {
    // key-service validates the app key
    mockCall.mockResolvedValueOnce({ valid: true, type: "app", appId: "test-app" });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_app_test123");
    // No x-org-id or x-user-id headers

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Organization context required");
  });

  it("should return 502 when client-service resolution fails", async () => {
    mockCall.mockResolvedValueOnce({ valid: true, type: "app", appId: "test-app" });
    mockCall.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_app_test123")
      .set("x-org-id", "org_2clerkOrg")
      .set("x-user-id", "user_2clerkUser");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Identity resolution failed");
  });

  it("should return 502 when client-service returns empty orgId", async () => {
    mockCall.mockResolvedValueOnce({ valid: true, type: "app", appId: "test-app" });
    mockCall.mockResolvedValueOnce({ orgId: null, userId: null });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_app_test123")
      .set("x-org-id", "org_2clerkOrg")
      .set("x-user-id", "user_2clerkUser");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Identity resolution returned incomplete data");
  });

  it("should allow /v1/me without identity headers for app keys", async () => {
    mockCall.mockResolvedValueOnce({ valid: true, type: "app", appId: "test-app" });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_app_test123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orgId: null, userId: null, authType: "app_key" });
  });

  it("should return 400 when only x-org-id is provided without x-user-id", async () => {
    mockCall.mockResolvedValueOnce({ valid: true, type: "app", appId: "test-app" });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_app_test123")
      .set("x-org-id", "org_2clerkOrg");
    // No x-user-id → resolution skipped → requireOrg fires

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Organization context required");
  });
});

describe("Auth middleware — user key", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("should use orgId directly from key-service without client-service call", async () => {
    mockCall.mockResolvedValueOnce({
      valid: true,
      type: "user",
      orgId: "org-uuid-direct",
    });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_test123");

    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe("org-uuid-direct");
    expect(res.body.authType).toBe("user_key");
    // Only one call (key validation), no client-service call
    expect(mockCall).toHaveBeenCalledTimes(1);
  });
});

describe("Auth middleware — error cases", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("should return 401 when no Authorization header", async () => {
    const res = await request(app).get("/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication");
  });

  it("should return 401 when key-service rejects the key", async () => {
    mockCall.mockResolvedValueOnce({ valid: false });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_invalid");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid API key");
  });
});
