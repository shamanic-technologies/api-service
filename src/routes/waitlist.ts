import { Router } from "express";
import { callExternalService, externalServices } from "../lib/service-client.js";

const router = Router();

// POST /v1/waitlist/request-access — public waitlist signup. Downstream
// client-service inserts the row and fires the confirmation email; api-service
// stays a transparent proxy.
router.post("/waitlist/request-access", async (req, res) => {
  try {
    const result = await callExternalService(
      externalServices.client,
      "/public/waitlist/request-access",
      { method: "POST", body: req.body },
    );
    res.json(result);
  } catch (error: any) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Failed to request waitlist access" });
  }
});

// GET /v1/waitlist/position?email=<email> — public position lookup
router.get("/waitlist/position", async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query["email"]) {
      params.set("email", req.query["email"] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.client,
      `/public/waitlist/position${qs}`,
    );
    res.json(result);
  } catch (error: any) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Failed to fetch waitlist position" });
  }
});

export default router;
