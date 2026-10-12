/**
 * The API's own description (the openapi catalogue documents), served with a
 * validator a client can revalidate against.
 *
 * The documents are ~5 MB and do not change while the process runs (a deploy
 * replaces the process), so each one is serialized ONCE and carries an ETag
 * derived from its bytes. A GET or HEAD whose `If-None-Match` names that ETag
 * is answered `304 Not Modified` with no body.
 *
 * Why not Express's built-in freshness check: `res.json` does set a weak ETag,
 * but `req.fresh` treats a request `Cache-Control: no-cache` as "never fresh",
 * and Node's own `fetch` ADDS `Cache-Control: no-cache` to every request that
 * carries `If-None-Match` (fetch spec, cache mode "no-store"). So every
 * conditional GET from our MCP server got the full 5 MB back. `no-cache` asks
 * the origin to revalidate, which is exactly what comparing the validator here
 * does, so a 304 is the correct answer to it.
 */

import { createHash } from "crypto";
import type { Request, Response } from "express";

export interface CatalogueBody {
  body: Buffer;
  etag: string;
}

/** Serialize a document once and derive its ETag from the bytes. */
export function catalogueBody(doc: unknown): CatalogueBody {
  const body = Buffer.from(JSON.stringify(doc), "utf8");
  const hash = createHash("sha256").update(body).digest("base64url").slice(0, 32);
  // Weak: a proxy that compresses the body (Cloudflare, Caddy) keeps a weak
  // validator as-is, and If-None-Match uses weak comparison anyway.
  return { body, etag: `W/"${hash}"` };
}

/** Weak comparison (RFC 9110 13.1.2): `*` or any listed tag equal once `W/` is dropped. */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const opaque = (t: string) => t.trim().replace(/^W\//, "");
  const want = opaque(etag);
  return ifNoneMatch.split(",").some((t) => t.trim() === "*" || opaque(t) === want);
}

/** Answer a catalogue read: 304 (no body) when the client already holds this version, else 200 + the bytes. */
export function sendCatalogue(req: Request, res: Response, doc: CatalogueBody) {
  res.setHeader("ETag", doc.etag);
  // Clients must revalidate every time (a route added to the API is visible at once).
  res.setHeader("Cache-Control", "no-cache");
  const inm = req.headers["if-none-match"];
  if (etagMatches(Array.isArray(inm) ? inm.join(",") : inm, doc.etag)) {
    res.status(304).end();
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(doc.body.length));
  res.status(200).end(req.method === "HEAD" ? undefined : doc.body);
}
