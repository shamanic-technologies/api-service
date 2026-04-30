import { Router, Request, Response } from "express";
import { authenticatePlatform } from "../middleware/auth.js";
import pg from "pg";

const { Pool } = pg;

const router = Router();

// ── Service → DATABASE_URL env var registry ─────────────────────────────────
const SERVICE_DB_REGISTRY: Record<string, string> = {
  "api-service": "API_SERVICE_DATABASE_URL",
  "client-service": "CLIENT_SERVICE_DATABASE_URL",
  "brand-service": "BRAND_SERVICE_DATABASE_URL",
  "campaign-service": "CAMPAIGN_SERVICE_DATABASE_URL",
  "workflow-service": "WORKFLOW_SERVICE_DATABASE_URL",
  "scraping-service": "SCRAPING_SERVICE_DATABASE_URL",
  "costs-service": "COSTS_SERVICE_DATABASE_URL",
  "runs-service": "RUNS_SERVICE_DATABASE_URL",
  "lead-service": "LEAD_SERVICE_DATABASE_URL",
  "apollo-service": "APOLLO_SERVICE_DATABASE_URL",
  "key-service": "KEY_SERVICE_DATABASE_URL",
  "api-registry-service": "API_REGISTRY_SERVICE_DATABASE_URL",
  "content-generation-service": "CONTENT_GENERATION_SERVICE_DATABASE_URL",
  "transactional-email-service": "TRANSACTIONAL_EMAIL_SERVICE_DATABASE_URL",
  "email-gateway-service": "EMAIL_GATEWAY_SERVICE_DATABASE_URL",
  "instantly-service": "INSTANTLY_SERVICE_DATABASE_URL",
  "postmark-service": "POSTMARK_SERVICE_DATABASE_URL",
  "billing-service": "BILLING_SERVICE_DATABASE_URL",
  "chat-service": "CHAT_SERVICE_DATABASE_URL",
  "outlets-service": "OUTLETS_SERVICE_DATABASE_URL",
  "journalists-service": "JOURNALISTS_SERVICE_DATABASE_URL",
  "articles-service": "ARTICLES_SERVICE_DATABASE_URL",
  "press-kits-service": "PRESS_KITS_SERVICE_DATABASE_URL",
  "google-service": "GOOGLE_SERVICE_DATABASE_URL",
  "features-service": "FEATURES_SERVICE_DATABASE_URL",
  "cloudflare-service": "CLOUDFLARE_SERVICE_DATABASE_URL",
  "human-service": "HUMAN_SERVICE_DATABASE_URL",
  "stripe-service": "STRIPE_SERVICE_DATABASE_URL",
  "ahref-service": "AHREF_SERVICE_DATABASE_URL",
};

// Lazy-initialized pools per service
const pools = new Map<string, pg.Pool>();

function getPool(serviceName: string): pg.Pool | null {
  const envVar = SERVICE_DB_REGISTRY[serviceName];
  if (!envVar) return null;

  const connectionString = process.env[envVar];
  if (!connectionString) return null;

  let pool = pools.get(serviceName);
  if (!pool) {
    pool = new Pool({ connectionString, max: 3 });
    pools.set(serviceName, pool);
  }
  return pool;
}

// ── GET /admin/services ─────────────────────────────────────────────────────
router.get("/admin/services", authenticatePlatform, (_req: Request, res: Response) => {
  const services = Object.keys(SERVICE_DB_REGISTRY).map((name) => ({
    name,
    available: !!process.env[SERVICE_DB_REGISTRY[name]],
  }));
  res.json({ services });
});

// ── GET /admin/services/:name/tables ────────────────────────────────────────
router.get("/admin/services/:name/tables", authenticatePlatform, async (req: Request, res: Response) => {
  const { name } = req.params;
  const pool = getPool(name);
  if (!pool) {
    return res.status(404).json({ error: `Service "${name}" not found or DB not configured` });
  }

  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name`
  );

  res.json({ tables: result.rows.map((r) => r.table_name) });
});

// ── GET /admin/services/:name/tables/:table/schema ──────────────────────────
router.get("/admin/services/:name/tables/:table/schema", authenticatePlatform, async (req: Request, res: Response) => {
  const { name, table } = req.params;
  const pool = getPool(name);
  if (!pool) {
    return res.status(404).json({ error: `Service "${name}" not found or DB not configured` });
  }

  // Validate table exists
  const tableCheck = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  if (tableCheck.rowCount === 0) {
    return res.status(404).json({ error: `Table "${table}" not found` });
  }

  const result = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );

  res.json({
    table,
    columns: result.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === "YES",
      default: r.column_default,
    })),
  });
});

// ── GET /admin/services/:name/tables/:table/rows ────────────────────────────
router.get("/admin/services/:name/tables/:table/rows", authenticatePlatform, async (req: Request, res: Response) => {
  const { name, table } = req.params;
  const pool = getPool(name);
  if (!pool) {
    return res.status(404).json({ error: `Service "${name}" not found or DB not configured` });
  }

  // Validate table exists and get columns
  const columnsResult = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  if (columnsResult.rowCount === 0) {
    return res.status(404).json({ error: `Table "${table}" not found` });
  }

  const validColumns = columnsResult.rows.map((r) => r.column_name);
  const textColumns = columnsResult.rows
    .filter((r) => ["character varying", "text", "varchar", "char", "character"].includes(r.data_type))
    .map((r) => r.column_name);

  // Parse query params
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const offset = parseInt(req.query.offset as string, 10) || 0;
  const sort = (req.query.sort as string) || "created_at";
  const order = ((req.query.order as string) || "desc").toLowerCase();
  const search = req.query.search as string | undefined;

  // Validate sort column
  if (!validColumns.includes(sort)) {
    return res.status(400).json({
      error: `Invalid sort column "${sort}". Valid columns: ${validColumns.join(", ")}`,
    });
  }

  // Validate order
  if (order !== "asc" && order !== "desc") {
    return res.status(400).json({ error: `Invalid order "${order}". Must be "asc" or "desc"` });
  }

  // Build query
  const params: unknown[] = [];
  let whereClause = "";

  if (search && textColumns.length > 0) {
    const conditions = textColumns.map((col, i) => {
      params.push(`%${search}%`);
      return `"${col}" ILIKE $${i + 1}`;
    });
    whereClause = `WHERE ${conditions.join(" OR ")}`;
  }

  // Sort column is validated above — safe to interpolate
  const query = `SELECT * FROM "${table}" ${whereClause} ORDER BY "${sort}" ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  // Get total count
  const countQuery = `SELECT COUNT(*) as total FROM "${table}" ${whereClause}`;
  const countParams = params.slice(0, params.length - 2); // exclude limit/offset

  const [dataResult, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, countParams),
  ]);

  res.json({
    rows: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    limit,
    offset,
  });
});

export default router;
