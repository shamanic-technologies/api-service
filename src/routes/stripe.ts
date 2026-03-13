import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import {
  CreateStripeProductRequestSchema,
  CreateStripePriceRequestSchema,
  CreateStripeCouponRequestSchema,
  CreateStripeCheckoutRequestSchema,
} from "../schemas.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// -----------------------------------------------------------------------
// Products
// -----------------------------------------------------------------------

/**
 * GET /v1/stripe/products/:productId
 * Retrieve a Stripe product by ID.
 */
router.get("/stripe/products/:productId", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const result = await callExternalService(
      externalServices.stripe,
      `/products/${encodeURIComponent(productId)}`,
      { headers: buildInternalHeaders(req) },
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
        headers: buildInternalHeaders(req),
        body: parsed.data,
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
 */
router.get("/stripe/products/:productId/prices", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const result = await callExternalService(
      externalServices.stripe,
      `/prices/by-product/${encodeURIComponent(productId)}`,
      { headers: buildInternalHeaders(req) },
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
        headers: buildInternalHeaders(req),
        body: parsed.data,
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
 */
router.get("/stripe/coupons/:couponId", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { couponId } = req.params;
    const result = await callExternalService(
      externalServices.stripe,
      `/coupons/${encodeURIComponent(couponId)}`,
      { headers: buildInternalHeaders(req) },
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
        headers: buildInternalHeaders(req),
        body: parsed.data,
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
        headers: buildInternalHeaders(req),
        body: parsed.data,
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
 * GET /v1/stripe/stats
 * Get Stripe sales stats.
 */
router.get("/stripe/stats", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.brandId) params.set("brandId", req.query.brandId as string);
    if (req.query.campaignId) params.set("campaignId", req.query.campaignId as string);
    if (req.query.runIds) params.set("runIds", req.query.runIds as string);

    const result = await callExternalService(
      externalServices.stripe,
      `/stats?${params}`,
      {
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get Stripe stats error:", error);
    res.status(500).json({ error: error.message || "Failed to get stats" });
  }
});

export default router;
