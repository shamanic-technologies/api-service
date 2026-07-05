import { Router } from "express";
import { authenticatePlatform, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";

const router = Router();

// GET /v1/admin/brands — staff-only cross-org brands list for the admin CRM.
//
// Transparent proxy to brand-service GET /internal/brands/all (a cross-org read,
// so NO org context). This is fleet-wide ops data the customer dashboard must not
// reach, so it is gated with authenticatePlatform + requireStaff (CLAUDE.md staff
// section): the shared platform key alone is not a staff signal, the x-email in the
// STAFF_EMAILS allowlist is. Response forwarded byte-for-byte (rule #8), upstream
// errors propagated verbatim (rule #7).
router.get("/admin/brands", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      "/internal/brands/all",
      { headers: req.staffEmail ? { "x-email": req.staffEmail } : {} }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list brands" });
  }
});

export default router;
