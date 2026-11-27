import pg from "pg";
import { raiseAlert } from "./security-watch.js";

/**
 * Durable gateway audit trail (SECURITY-ALERTS-1128). One row per `/internal/admin/*` call,
 * per API key mint and per security detection (`security-watch.ts`): who (user, org, staff
 * email, forwarded identity), from where (IP, user agent), what (method, path, status, key
 * NAME, never a key value). Kept 90 days, then deleted by the in-process sweep below.
 *
 * Its own database (`API_SERVICE_DATABASE_URL`, provisioned on the box with
 * `provision-db.sh api-service`): container logs vanish at every deploy, and the 2026-11-20
 * intrusion was reconstructed from nothing durable. Writes happen after the response
 * (`finish`), never on the request path. A row that cannot be written is logged and raises
 * one `audit_store_unavailable` alert per day: the trail going dark is itself an incident.
 */

export interface AuditRow {
  kind: string;
  method: string;
  path: string;
  status: number;
  ip: string;
  userAgent: string | null;
  authType: string | null;
  userId: string | null;
  orgId: string | null;
  staffEmail: string | null;
  xEmail: string | null;
  externalUserId: string | null;
  keyName: string | null;
  requestId: string | null;
}

export const AUDIT_RETENTION_DAYS = 90;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS security_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status integer NOT NULL,
  ip text NOT NULL,
  user_agent text,
  auth_type text,
  user_id text,
  org_id text,
  staff_email text,
  x_email text,
  external_user_id text,
  key_name text,
  request_id text
);
CREATE INDEX IF NOT EXISTS security_audit_at_idx ON security_audit (at);
CREATE INDEX IF NOT EXISTS security_audit_kind_at_idx ON security_audit (kind, at);
`;

export type AuditWriter = (row: AuditRow) => Promise<void>;

let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): pg.Pool {
  const url = process.env.API_SERVICE_DATABASE_URL;
  if (!url) throw new Error("API_SERVICE_DATABASE_URL is not set: the security audit trail cannot be stored");
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000 });
    pool.on("error", (err) => console.error("[security-audit] pool error:", err.message));
  }
  return pool;
}

export function ensureAuditSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err: Error) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

async function insertRow(row: AuditRow): Promise<void> {
  await ensureAuditSchema();
  await getPool().query(
    `INSERT INTO security_audit (kind, method, path, status, ip, user_agent, auth_type, user_id, org_id, staff_email, x_email, external_user_id, key_name, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [row.kind, row.method, row.path, row.status, row.ip, row.userAgent, row.authType, row.userId, row.orgId, row.staffEmail, row.xEmail, row.externalUserId, row.keyName, row.requestId],
  );
}

let writer: AuditWriter = process.env.VITEST ? async () => {} : insertRow;

/** Tests only: capture rows instead of writing them. */
export function setAuditWriter(next: AuditWriter): void {
  writer = next;
}

export function recordAudit(row: AuditRow): void {
  writer(row).catch((err: Error) => {
    console.error(`[security-audit] row NOT stored (${row.kind} ${row.method} ${row.path}): ${err.message}`);
    raiseAlert(
      "audit_store_unavailable",
      "security_audit",
      "The API gateway could not store a security audit row",
      [`Error: ${err.message}`, `Row: ${row.kind} ${row.method} ${row.path} -> ${row.status} from ${row.ip}`],
    );
  });
}

export async function pruneAudit(): Promise<number> {
  const result = await getPool().query(`DELETE FROM security_audit WHERE at < now() - make_interval(days => $1)`, [AUDIT_RETENTION_DAYS]);
  return result.rowCount ?? 0;
}

/**
 * Called after `listen()`: create the table, then delete rows past 90 days once a day
 * (first pass ~60 s after boot: deploys restart the process more often than daily).
 */
export function startAuditMaintenance(): void {
  const run = () =>
    ensureAuditSchema()
      .then(pruneAudit)
      .then((n) => console.log(`[security-audit] retention sweep removed ${n} rows older than ${AUDIT_RETENTION_DAYS} days`))
      .catch((err: Error) => {
        console.error("[security-audit] maintenance failed:", err.message);
        raiseAlert("audit_store_unavailable", "security_audit", "The API gateway security audit store is unavailable", [`Error: ${err.message}`]);
      });
  setTimeout(run, 60_000).unref();
  setInterval(run, 24 * 3_600_000).unref();
}
