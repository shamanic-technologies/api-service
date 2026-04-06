import { describe, it, expect } from "vitest";
import { buildInternalHeaders } from "../../src/lib/internal-headers.js";
import { AuthenticatedRequest } from "../../src/middleware/auth.js";

function fakeReq(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    orgId: "org-1",
    userId: "user-1",
    query: {},
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

describe("buildInternalHeaders", () => {
  it("forwards all identity headers from req", () => {
    const headers = buildInternalHeaders(fakeReq({
      orgId: "org-1",
      userId: "user-1",
      runId: "run-1",
      campaignId: "camp-1",
      brandId: "brand-1",
      workflowSlug: "wf-slug",
      featureSlug: "ft-slug",
    }));
    expect(headers).toEqual({
      "x-org-id": "org-1",
      "x-user-id": "user-1",
      "x-run-id": "run-1",
      "x-campaign-id": "camp-1",
      "x-brand-id": "brand-1",
      "x-workflow-slug": "wf-slug",
      "x-feature-slug": "ft-slug",
    });
  });

  it("promotes brandId from query param to x-brand-id header", () => {
    const headers = buildInternalHeaders(fakeReq({
      query: { brandId: "brand-from-query" } as any,
    }));
    expect(headers["x-brand-id"]).toBe("brand-from-query");
  });

  it("promotes campaignId from query param to x-campaign-id header", () => {
    const headers = buildInternalHeaders(fakeReq({
      query: { campaignId: "camp-from-query" } as any,
    }));
    expect(headers["x-campaign-id"]).toBe("camp-from-query");
  });

  it("uses header value when query param matches", () => {
    const headers = buildInternalHeaders(fakeReq({
      brandId: "brand-1",
      query: { brandId: "brand-1" } as any,
    }));
    expect(headers["x-brand-id"]).toBe("brand-1");
  });

  it("throws 400 when brandId header and query param conflict", () => {
    expect(() =>
      buildInternalHeaders(fakeReq({
        brandId: "brand-header",
        query: { brandId: "brand-query" } as any,
      })),
    ).toThrow(/Conflict/);

    try {
      buildInternalHeaders(fakeReq({
        brandId: "brand-header",
        query: { brandId: "brand-query" } as any,
      }));
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
    }
  });

  it("throws 400 when campaignId header and query param conflict", () => {
    expect(() =>
      buildInternalHeaders(fakeReq({
        campaignId: "camp-header",
        query: { campaignId: "camp-query" } as any,
      })),
    ).toThrow(/Conflict/);
  });

  it("promotes featureSlug from query param to x-feature-slug header", () => {
    const headers = buildInternalHeaders(fakeReq({
      query: { featureSlug: "ft-from-query" } as any,
    }));
    expect(headers["x-feature-slug"]).toBe("ft-from-query");
  });

  it("promotes workflowSlug from query param to x-workflow-slug header", () => {
    const headers = buildInternalHeaders(fakeReq({
      query: { workflowSlug: "wf-from-query" } as any,
    }));
    expect(headers["x-workflow-slug"]).toBe("wf-from-query");
  });

  it("throws 400 when featureSlug header and query param conflict", () => {
    expect(() =>
      buildInternalHeaders(fakeReq({
        featureSlug: "ft-header",
        query: { featureSlug: "ft-query" } as any,
      })),
    ).toThrow(/Conflict/);
  });

  it("throws 400 when workflowSlug header and query param conflict", () => {
    expect(() =>
      buildInternalHeaders(fakeReq({
        workflowSlug: "wf-header",
        query: { workflowSlug: "wf-query" } as any,
      })),
    ).toThrow(/Conflict/);
  });

  it("omits optional headers when not present", () => {
    const headers = buildInternalHeaders(fakeReq());
    expect(headers).toEqual({
      "x-org-id": "org-1",
      "x-user-id": "user-1",
    });
    expect(headers).not.toHaveProperty("x-brand-id");
    expect(headers).not.toHaveProperty("x-campaign-id");
    expect(headers).not.toHaveProperty("x-run-id");
  });

  it("does NOT include x-app-id or x-key-source (removed)", () => {
    const headers = buildInternalHeaders(fakeReq({
      orgId: "org-1",
      userId: "user-1",
      brandId: "brand-1",
      campaignId: "camp-1",
      runId: "run-1",
      workflowSlug: "wf",
      featureSlug: "ft",
    }));
    expect(headers).not.toHaveProperty("x-app-id");
    expect(headers).not.toHaveProperty("x-key-source");
  });
});
