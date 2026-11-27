import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * SECRETS-ROTATE-1127. The table browser served OAuth refresh/access tokens, Stripe client
 * secrets and share tokens in clear on 2026-11-20. Credential columns are redacted in every
 * row, staff included, and are never searchable or sortable.
 */
const queries: Array<{ sql: string; params?: unknown[] }> = [];

vi.mock("pg", () => {
  class Pool {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return {
          rowCount: 4,
          rows: [
            { column_name: "id", data_type: "uuid" },
            { column_name: "email", data_type: "text" },
            { column_name: "refresh_token", data_type: "text" },
            { column_name: "client_secret", data_type: "text" },
            { column_name: "created_at", data_type: "timestamp with time zone" },
          ],
        };
      }
      if (sql.startsWith("SELECT COUNT")) return { rows: [{ total: "1" }] };
      return {
        rows: [
          { id: "r1", email: "a@b.com", refresh_token: "1//0g-real-refresh", client_secret: "pi_123_secret_abc", created_at: "2026-11-20" },
          { id: "r2", email: "c@d.com", refresh_token: null, client_secret: "pi_456_secret_def", created_at: "2026-11-19" },
        ],
      };
    }
    async end() {}
  }
  return { default: { Pool }, Pool };
});

const PLATFORM_KEY = "secrets-rotate-redaction-key";
const STAFF = { "x-email": "kevin@distribute.you", "x-external-user-id": "user_2yaCEpxeoOEIfXTdxTMY8pM8jXW" };

let adminRoutes: any;
let isCredentialColumn: (n: string) => boolean;

beforeAll(async () => {
  process.env.ADMIN_DISTRIBUTE_API_KEY = PLATFORM_KEY;
  process.env.GOOGLE_SERVICE_DATABASE_URL = "postgres://unused";
  const mod = await import("../../src/routes/admin.js");
  adminRoutes = mod.default;
  isCredentialColumn = mod.isCredentialColumn;
});

function app() {
  const a = express();
  a.use("/internal", adminRoutes);
  return a;
}

const ROWS = "/internal/admin/services/google-service/tables/google_oauth_tokens/rows";

describe("table browser never serves credential columns", () => {
  it("redacts token/secret columns in every row for staff", async () => {
    const res = await request(app()).get(ROWS).set("x-api-key", PLATFORM_KEY).set(STAFF);
    expect(res.status).toBe(200);
    expect(res.body.rows[0]).toEqual({
      id: "r1",
      email: "a@b.com",
      refresh_token: "[redacted]",
      client_secret: "[redacted]",
      created_at: "2026-11-20",
    });
    expect(res.body.rows[1].refresh_token).toBeNull();
    expect(res.body.rows[1].client_secret).toBe("[redacted]");
    expect(JSON.stringify(res.body)).not.toContain("secret_abc");
    expect(JSON.stringify(res.body)).not.toContain("real-refresh");
  });

  it("never searches inside a credential column", async () => {
    queries.length = 0;
    await request(app()).get(`${ROWS}?search=1//0g`).set("x-api-key", PLATFORM_KEY).set(STAFF);
    const select = queries.find((q) => q.sql.startsWith("SELECT *"));
    expect(select?.sql).toContain('"email" ILIKE');
    expect(select?.sql).not.toContain("refresh_token");
    expect(select?.sql).not.toContain("client_secret");
  });

  it("refuses to sort on a credential column", async () => {
    const res = await request(app()).get(`${ROWS}?sort=refresh_token`).set("x-api-key", PLATFORM_KEY).set(STAFF);
    expect(res.status).toBe(400);
  });

  it("names the incident's columns as credentials", () => {
    for (const c of ["refresh_token", "access_token", "client_secret", "token", "api_key", "apiKey", "password_hash", "session_cookie", "sentry_dsn"]) {
      expect(isCredentialColumn(c)).toBe(true);
    }
    for (const c of ["id", "email", "created_at", "org_id", "subject"]) {
      expect(isCredentialColumn(c)).toBe(false);
    }
  });
});
