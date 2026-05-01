import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock pg before importing the route
const mockQuery = vi.fn();

vi.mock("pg", () => {
  class MockPool {
    query = mockQuery;
  }
  return {
    default: { Pool: MockPool },
  };
});

// Mock auth — keep authenticatePlatform real
vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/middleware/auth.js")>();
  return {
    ...actual,
    authenticate: (_req: any, _res: any, next: any) => next(),
    requireOrg: (_req: any, _res: any, next: any) => next(),
    requireUser: (_req: any, _res: any, next: any) => next(),
  };
});

import adminRoutes from "../../src/routes/admin.js";

const VALID_API_KEY = "test-admin-distribute-key";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/internal", adminRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_DISTRIBUTE_API_KEY = VALID_API_KEY;
  process.env.BRAND_SERVICE_DATABASE_URL = "postgres://localhost/brand";
  process.env.RUNS_SERVICE_DATABASE_URL = "postgres://localhost/runs";
});

describe("GET /internal/admin/services", () => {
  it("returns list of services with availability", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.services).toBeInstanceOf(Array);
    expect(res.body.services.length).toBeGreaterThan(0);

    const brandService = res.body.services.find((s: any) => s.name === "brand-service");
    expect(brandService).toBeDefined();
    expect(brandService.available).toBe(true);

    const chatService = res.body.services.find((s: any) => s.name === "chat-service");
    expect(chatService).toBeDefined();
    expect(chatService.available).toBe(false);
  });

  it("rejects requests without API key", async () => {
    const app = createApp();
    const res = await request(app).get("/internal/admin/services");
    expect(res.status).toBe(401);
  });
});

describe("GET /internal/admin/services/:name/tables", () => {
  it("returns table objects with name and rowCount", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { table_name: "brands", row_count: "42" },
        { table_name: "extractions", row_count: "7" },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/brand-service/tables")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.tables).toEqual([
      { name: "brands", rowCount: 42 },
      { name: "extractions", rowCount: 7 },
    ]);
  });

  it("returns 404 for non-existent service", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/nonexistent-service/tables")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });
});

describe("GET /internal/admin/services/:name/tables/:table/schema", () => {
  it("returns column schema with isPrimaryKey", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { column_name: "id", data_type: "uuid", is_nullable: "NO", is_primary_key: true },
        { column_name: "name", data_type: "text", is_nullable: "YES", is_primary_key: false },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/brand-service/tables/brands/schema")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.columns).toHaveLength(2);
    expect(res.body.columns[0]).toEqual({
      name: "id",
      type: "uuid",
      nullable: false,
      isPrimaryKey: true,
    });
    expect(res.body.columns[1]).toEqual({
      name: "name",
      type: "text",
      nullable: true,
      isPrimaryKey: false,
    });
  });

  it("returns 404 for non-existent table", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/brand-service/tables/nonexistent/schema")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  it("returns 404 for non-existent service", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/nonexistent-service/tables/brands/schema")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(404);
  });
});

describe("GET /internal/admin/services/:name/tables/:table/rows", () => {
  it("returns paginated rows", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 3,
      rows: [
        { column_name: "id", data_type: "uuid" },
        { column_name: "name", data_type: "text" },
        { column_name: "created_at", data_type: "timestamp with time zone" },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "1", name: "test", created_at: "2024-01-01" }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: "1" }],
    });

    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/brand-service/tables/brands/rows?limit=10&offset=0")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(0);
  });

  it("rejects invalid sort column (SQL injection prevention)", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { column_name: "id", data_type: "uuid" },
        { column_name: "name", data_type: "text" },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/brand-service/tables/brands/rows?sort=id;DROP TABLE brands")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid sort column");
  });

  it("rejects invalid order value", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ column_name: "id", data_type: "uuid" }],
    });

    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/brand-service/tables/brands/rows?sort=id&order=INVALID")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid order");
  });

  it("returns 404 for non-existent table", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/brand-service/tables/nonexistent/rows")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(404);
  });

  it("supports search across text columns", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { column_name: "id", data_type: "uuid" },
        { column_name: "name", data_type: "text" },
        { column_name: "created_at", data_type: "timestamp with time zone" },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "1", name: "Acme Corp" }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: "1" }],
    });

    const app = createApp();
    const res = await request(app)
      .get("/internal/admin/services/brand-service/tables/brands/rows?search=acme")
      .set("X-API-Key", VALID_API_KEY);

    expect(res.status).toBe(200);

    // Verify the data query used ILIKE
    const dataCall = mockQuery.mock.calls[1];
    expect(dataCall[0]).toContain("ILIKE");
    expect(dataCall[1][0]).toBe("%acme%");
  });
});
