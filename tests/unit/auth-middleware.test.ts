import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../../src/middleware/auth.js";

// Mock fetch for validateKey (calls key-service /validate directly)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock callExternalService for resolveExternalIds (calls client-service /resolve)
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

/** Helper: mock a successful key-service /validate response */
function mockValidateSuccess(result: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(result),
  });
}

/** Helper: mock a 401 from key-service /validate (invalid key) */
function mockValidateUnauthorized() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ error: "Invalid API key" }),
  });
}

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
    res.json({ appId: req.appId || null, orgId: req.orgId || null, userId: req.userId || null, authType: req.authType });
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
    // key-service validates the app key (via fetch)
    mockValidateSuccess({ valid: true, type: "app", appId: "test-app" });
    // client-service resolves external IDs (via callExternalService)
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

    // Verify fetch was called for /validate (no X-API-Key header)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://key-service/validate",
      { headers: { Authorization: "Bearer mcpf_app_test123" } },
    );

    // Verify client-service was called with correct body
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall).toHaveBeenCalledWith(
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
    mockValidateSuccess({ valid: true, type: "app", appId: "test-app" });

    const res = await request(app)
      .get("/v1/workflows")
      .set("Authorization", "Bearer mcpf_app_test123");
    // No x-org-id or x-user-id headers

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Organization context required");
  });

  it("should return 502 when client-service resolution fails", async () => {
    mockValidateSuccess({ valid: true, type: "app", appId: "test-app" });
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
    mockValidateSuccess({ valid: true, type: "app", appId: "test-app" });
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
    mockValidateSuccess({ valid: true, type: "app", appId: "test-app" });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_app_test123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ appId: "test-app", orgId: null, userId: null, authType: "app_key" });
  });

  it("should return 400 when only x-org-id is provided without x-user-id", async () => {
    mockValidateSuccess({ valid: true, type: "app", appId: "test-app" });

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

  it("should set appId, orgId, userId from key-service without client-service call", async () => {
    mockValidateSuccess({
      valid: true,
      type: "user",
      appId: "distribute-frontend",
      orgId: "org-uuid-direct",
      userId: "user-uuid-direct",
    });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_usr_test123");

    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe("org-uuid-direct");
    expect(res.body.authType).toBe("user_key");
    // Only fetch for validation, no callExternalService for client-service
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockCall).toHaveBeenCalledTimes(0);
  });

  it("should pass requireOrg and requireUser when user key carries full identity", async () => {
    mockValidateSuccess({
      valid: true,
      type: "user",
      appId: "distribute-frontend",
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
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockCall).toHaveBeenCalledTimes(0);
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

  it("should return 401 when key-service returns valid:false", async () => {
    mockValidateSuccess({ valid: false });

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_invalid");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid API key");
  });

  it("should return 401 when key-service returns 401 (no stack trace logged)", async () => {
    mockValidateUnauthorized();

    const res = await request(app)
      .get("/v1/me")
      .set("Authorization", "Bearer mcpf_invalid");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid API key");
    // Fetch was called but no callExternalService (no stack trace from throw)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockCall).not.toHaveBeenCalled();
  });
});
