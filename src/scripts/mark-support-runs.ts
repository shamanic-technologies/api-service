/**
 * Bulk-marks PAST gateway request runs with their support function
 * (COST-SUPPORT-1024), through runs-service's owner door
 * (`POST /v1/platform-runs/support-marks/{preview,apply}`, x-service-name =
 * api-service: it marks our own runs only). New runs are marked at creation by
 * `authenticate`; this script applies the SAME table (`supportFunctionFor`) to
 * the runs opened before it shipped.
 *
 * Input: a JSONL file, one `{"id": "<run uuid>", "taskName": "POST /v1/chat"}`
 * per line = the gateway runs whose subtree carries spend and declares no
 * produced outcome (a run whose subtree declares stays unmarked). Idempotent:
 * runs-service keeps a run's first mark and counts it as already marked.
 *
 * Inside the api-service container:
 *   node dist/scripts/mark-support-runs.js /tmp/runs.jsonl            # preview
 *   node dist/scripts/mark-support-runs.js /tmp/runs.jsonl --apply    # write
 */
import { readFileSync } from "node:fs";
import { supportFunctionFor } from "../lib/support-function.js";

const CHUNK = 5000;

async function door(step: "preview" | "apply", body: unknown): Promise<unknown> {
  const url = process.env.RUNS_SERVICE_URL;
  const key = process.env.RUNS_SERVICE_API_KEY;
  if (!url || !key) throw new Error("RUNS_SERVICE_URL / RUNS_SERVICE_API_KEY missing");
  const res = await fetch(`${url}/v1/platform-runs/support-marks/${step}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "x-service-name": "api-service" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`support-marks/${step} ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error("usage: mark-support-runs <runs.jsonl> [--apply]");
  const apply = flag === "--apply";

  const groups = new Map<string, { kind: string; reason: string; ids: string[] }>();
  let unmatched = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const { id, taskName } = JSON.parse(line) as { id: string; taskName: string };
    const space = taskName.indexOf(" ");
    const fn = space > 0 ? supportFunctionFor(taskName.slice(0, space), taskName.slice(space + 1)) : null;
    if (!fn) {
      unmatched++;
      continue;
    }
    const k = `${fn.kind}\u0000${fn.reason}`;
    const g = groups.get(k) ?? { kind: fn.kind, reason: fn.reason, ids: [] };
    g.ids.push(id);
    groups.set(k, g);
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", unmatched }));
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += CHUNK) {
      const body = {
        kind: g.kind,
        reason: g.reason,
        markedBy: "api-service COST-SUPPORT-1024 backfill",
        runIds: g.ids.slice(i, i + CHUNK),
      };
      const out = await door(apply ? "apply" : "preview", body);
      console.log(JSON.stringify({ kind: g.kind, reason: g.reason, runs: body.runIds.length, out }));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
