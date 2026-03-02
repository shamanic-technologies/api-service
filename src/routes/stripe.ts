import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import {
  CreateStripeProductRequestSchema,
  CreateStripePriceRequestSchema,
  CreateStripeCouponRequestSchema,
  CreateStripeCheckoutRequestSchema,
  StripeStatsRequestSchema,
} from "../schemas.js";

const router = Router();

// -----------------------------------------------------------------------
// Products
// -----------------------------------------------------------------------

/**
 * GET /v1/stripe/products/:productId
 * Retrieve a Stripe product by ID.
 * Only needs appId (to resolve Stripe key) — no org context required.
 */
router.get("/stripe/products/:productId", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const result = await callExternalService(
      externalServices.stripe,
      `/products/${encodeURIComponent(productId)}?appId=${encodeURIComponent(req.appId!)}`,
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get Stripe product error:", error);
    res.status(500).json({ error: error.message || "Failed to get product" });
  }
});

/**
 * POST /v1/stripe/products
 * Create a Stripe product.
 * Only needs appId — orgId forwarded when available for tracking.
 */
router.post("/stripe/products", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = CreateStripeProductRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.stripe,
      "/products/create",
      {
        method: "POST",
        body: { appId: req.appId, ...(req.orgId && { orgId: req.orgId }), ...parsed.data },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Create Stripe product error:", error);
    res.status(500).json({ error: error.message || "Failed to create product" });
  }
});

// -----------------------------------------------------------------------
// Prices
// -----------------------------------------------------------------------

/**
 * GET /v1/stripe/products/:productId/prices
 * List active prices for a Stripe product.
 * Only needs appId — no org context required.
 */
router.get("/stripe/products/:productId/prices", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const result = await callExternalService(
      externalServices.stripe,
      `/prices/by-product/${encodeURIComponent(productId)}?appId=${encodeURIComponent(req.appId!)}`,
    );
    res.json(result);
  } catch (error: any) {
    console.error("List Stripe prices error:", error);
    res.status(500).json({ error: error.message || "Failed to list prices" });
  }
});

/**
 * POST /v1/stripe/prices
 * Create a Stripe price.
 * Only needs appId — orgId forwarded when available for tracking.
 */
router.post("/stripe/prices", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = CreateStripePriceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.stripe,
      "/prices/create",
      {
        method: "POST",
        body: { appId: req.appId, ...(req.orgId && { orgId: req.orgId }), ...parsed.data },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Create Stripe price error:", error);
    res.status(500).json({ error: error.message || "Failed to create price" });
  }
});

// -----------------------------------------------------------------------
// Coupons
// -----------------------------------------------------------------------

/**
 * GET /v1/stripe/coupons/:couponId
 * Retrieve a Stripe coupon by ID.
 * Only needs appId — no org context required.
 */
router.get("/stripe/coupons/:couponId", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { couponId } = req.params;
    const result = await callExternalService(
      externalServices.stripe,
      `/coupons/${encodeURIComponent(couponId)}?appId=${encodeURIComponent(req.appId!)}`,
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get Stripe coupon error:", error);
    res.status(500).json({ error: error.message || "Failed to get coupon" });
  }
});

/**
 * POST /v1/stripe/coupons
 * Create a Stripe coupon.
 * Only needs appId — orgId forwarded when available for tracking.
 */
router.post("/stripe/coupons", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = CreateStripeCouponRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.stripe,
      "/coupons/create",
      {
        method: "POST",
        body: { appId: req.appId, ...(req.orgId && { orgId: req.orgId }), ...parsed.data },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Create Stripe coupon error:", error);
    res.status(500).json({ error: error.message || "Failed to create coupon" });
  }
});

// -----------------------------------------------------------------------
// Checkout (requires org context — user-facing operation)
// -----------------------------------------------------------------------

/**
 * POST /v1/stripe/checkout
 * Create a Stripe Checkout session.
 * Requires org/user context for tracking the purchase.
 */
router.post("/stripe/checkout", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = CreateStripeCheckoutRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.stripe,
      "/checkout/create",
      {
        method: "POST",
        body: { appId: req.appId, orgId: req.orgId, userId: req.userId, ...parsed.data },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Create Stripe checkout error:", error);
    res.status(500).json({ error: error.message || "Failed to create checkout session" });
  }
});

// -----------------------------------------------------------------------
// Stats (requires org context — scoped to org data)
// -----------------------------------------------------------------------

/**
 * POST /v1/stripe/stats
 * Get Stripe sales stats.
 * Requires org context to scope the stats query.
 */
router.post("/stripe/stats", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = StripeStatsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.stripe,
      "/stats",
      {
        method: "POST",
        body: { appId: req.appId, orgId: req.orgId, ...parsed.data },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get Stripe stats error:", error);
    res.status(500).json({ error: error.message || "Failed to get stats" });
  }
});

export default router;
