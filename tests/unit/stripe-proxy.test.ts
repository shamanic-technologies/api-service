import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth middleware
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.appId = "distribute-frontend";
    req.authType = "user_key";
    next();
  },
  requireOrg: (req: any, res: any, next: any) => {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    next();
  },
  requireUser: (req: any, res: any, next: any) => {
    if (!req.userId) return res.status(401).json({ error: "User identity required" });
    next();
  },
  AuthenticatedRequest: {},
}));

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
}

let fetchCalls: FetchCall[] = [];

import stripeRoutes from "../../src/routes/stripe.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", stripeRoutes);
  return app;
}

function mockFetchOk(responseData: any = {}) {
  fetchCalls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    fetchCalls.push({ url, method: init?.method, body });
    return { ok: true, json: () => Promise.resolve(responseData) };
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

describe("GET /v1/stripe/products/:productId", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({ id: "prod_123", name: "Webinar Access" });
    app = createApp();
  });

  it("should proxy to stripe-service with appId query param", async () => {
    const res = await request(app).get("/v1/stripe/products/prod_123");

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Webinar Access");

    const call = fetchCalls.find((c) => c.url.includes("/products/prod_123"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("appId=distribute-frontend");
  });
});

describe("POST /v1/stripe/products", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({ id: "prod_new", name: "Course" });
    app = createApp();
  });

  it("should forward product creation with appId and orgId", async () => {
    const res = await request(app)
      .post("/v1/stripe/products")
      .send({ name: "Course", description: "Online course" });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/products/create"));
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
    expect(call!.body).toMatchObject({
      appId: "distribute-frontend",
      orgId: "org_test456",
      name: "Course",
      description: "Online course",
    });
  });

  it("should return 400 when name is missing", async () => {
    const res = await request(app).post("/v1/stripe/products").send({});
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

describe("GET /v1/stripe/products/:productId/prices", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({ prices: [{ id: "price_123", unitAmount: 4999 }] });
    app = createApp();
  });

  it("should proxy to stripe-service prices endpoint", async () => {
    const res = await request(app).get("/v1/stripe/products/prod_123/prices");

    expect(res.status).toBe(200);
    expect(res.body.prices).toHaveLength(1);

    const call = fetchCalls.find((c) => c.url.includes("/prices/by-product/prod_123"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("appId=distribute-frontend");
  });
});

describe("POST /v1/stripe/prices", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({ id: "price_new" });
    app = createApp();
  });

  it("should forward price creation with required fields", async () => {
    const res = await request(app)
      .post("/v1/stripe/prices")
      .send({ productId: "prod_123", unitAmountCents: 4999, currency: "usd" });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/prices/create"));
    expect(call!.body).toMatchObject({
      appId: "distribute-frontend",
      productId: "prod_123",
      unitAmountCents: 4999,
    });
  });

  it("should return 400 when productId is missing", async () => {
    const res = await request(app)
      .post("/v1/stripe/prices")
      .send({ unitAmountCents: 4999 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

describe("GET /v1/stripe/coupons/:couponId", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({ id: "WELCOME20", percentOff: 20 });
    app = createApp();
  });

  it("should proxy to stripe-service coupons endpoint", async () => {
    const res = await request(app).get("/v1/stripe/coupons/WELCOME20");

    expect(res.status).toBe(200);
    expect(res.body.percentOff).toBe(20);

    const call = fetchCalls.find((c) => c.url.includes("/coupons/WELCOME20"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("appId=distribute-frontend");
  });
});

describe("POST /v1/stripe/coupons", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({ id: "WELCOME20" });
    app = createApp();
  });

  it("should forward coupon creation", async () => {
    const res = await request(app)
      .post("/v1/stripe/coupons")
      .send({ percentOff: 20, duration: "once" });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/coupons/create"));
    expect(call!.body).toMatchObject({
      appId: "distribute-frontend",
      percentOff: 20,
      duration: "once",
    });
  });

  it("should return 400 when duration is missing", async () => {
    const res = await request(app)
      .post("/v1/stripe/coupons")
      .send({ percentOff: 20 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

describe("POST /v1/stripe/checkout", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({ url: "https://checkout.stripe.com/session_123", sessionId: "cs_123" });
    app = createApp();
  });

  it("should forward checkout session creation with identity fields", async () => {
    const res = await request(app)
      .post("/v1/stripe/checkout")
      .send({
        lineItems: [{ priceId: "price_123", quantity: 1 }],
        mode: "payment",
        successUrl: "https://polarity.com/success",
        cancelUrl: "https://polarity.com/cancel",
        customerEmail: "user@polarity.com",
      });

    expect(res.status).toBe(200);
    expect(res.body.url).toContain("checkout.stripe.com");

    const call = fetchCalls.find((c) => c.url.includes("/checkout/create"));
    expect(call!.body).toMatchObject({
      appId: "distribute-frontend",
      orgId: "org_test456",
      userId: "user_test123",
      lineItems: [{ priceId: "price_123", quantity: 1 }],
      successUrl: "https://polarity.com/success",
      cancelUrl: "https://polarity.com/cancel",
      customerEmail: "user@polarity.com",
    });
  });

  it("should return 400 when lineItems is missing", async () => {
    const res = await request(app)
      .post("/v1/stripe/checkout")
      .send({ successUrl: "https://x.com", cancelUrl: "https://x.com" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe("POST /v1/stripe/stats", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({ totalRevenue: 12500, totalOrders: 5 });
    app = createApp();
  });

  it("should forward stats request with identity", async () => {
    const res = await request(app)
      .post("/v1/stripe/stats")
      .send({ brandId: "brand_abc" });

    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(12500);

    const call = fetchCalls.find((c) => c.url.includes("/stats"));
    expect(call!.body).toMatchObject({
      appId: "distribute-frontend",
      orgId: "org_test456",
      brandId: "brand_abc",
    });
  });

  it("should allow empty body for unfiltered stats", async () => {
    const res = await request(app).post("/v1/stripe/stats").send({});
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("Stripe proxy — error handling", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Stripe API error" }),
      text: () => Promise.resolve('{"error":"Stripe API error"}'),
    }));
    app = createApp();
  });

  it("should return 500 when stripe-service fails", async () => {
    const res = await request(app).get("/v1/stripe/products/prod_fail");
    expect(res.status).toBe(500);
  });
});
