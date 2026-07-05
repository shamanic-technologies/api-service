import { Router, Request, Response } from "express";
import { callExternalService, externalServices } from "../lib/service-client.js";

const router = Router();

/**
 * POST /public/conversions
 * PUBLIC ingest endpoint — NO Clerk auth. Called directly by third-party client
 * websites (conversion snippet / server-side postback). Authenticated downstream
 * by the per-brand conversion token, NOT by a Clerk session.
 *
 * Proxied to lead-service POST /public/conversions. Forwards the raw JSON body
 * untouched plus the `x-conversion-token` header and any `Authorization: Bearer`
 * header — lead-service uses those to resolve + authenticate the brand. Response
 * (expected 200 { received: true }, or its 400/401) is forwarded transparently.
 */
router.post("/public/conversions", async (req: Request, res: Response) => {
  try {
    const headers: Record<string, string> = {};
    const token = req.header("x-conversion-token");
    if (token) headers["x-conversion-token"] = token;
    const authorization = req.header("authorization");
    if (authorization) headers["Authorization"] = authorization;

    const result = await callExternalService(
      externalServices.lead,
      "/public/conversions",
      { method: "POST", headers, body: req.body },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public conversions ingest error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to ingest conversion" });
  }
});

export default router;
