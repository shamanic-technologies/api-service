import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/instantly.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

describe("Instantly audit proxy route (source)", () => {
  it("should have GET /instantly/audit/sending-forecast route", () => {
    expect(content).toContain('"/instantly/audit/sending-forecast"');
    expect(content).toContain("router.get");
  });

  it("forwards to instantly-service downstream path verbatim", () => {
    expect(content).toContain("externalServices.instantly");
    expect(content).toContain('"/internal/audit/sending-forecast"');
  });

  it("is staff-gated with authenticatePlatform + requireStaff (no org)", () => {
    // Scope to the route handler chain (the import block also lists both names).
    const mountIdx = content.indexOf('"/instantly/audit/sending-forecast"');
    const chain = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(chain).toContain("authenticatePlatform,");
    expect(chain).toContain("requireStaff,");
    // Cross-org platform read: no requireOrg on the chain.
    expect(chain).not.toContain("requireOrg");
  });

  it("forwards the verified staff x-email downstream for attribution", () => {
    expect(content).toContain("req.staffEmail");
    expect(content).toContain('"x-email"');
  });

  it("propagates upstream errors verbatim (no generic mask)", () => {
    expect(content).toContain("error.statusCode || 500");
    expect(content).toContain("error.message");
    expect(content).not.toContain("Service call failed");
  });

  it("is mounted under /v1 in index.ts", () => {
    expect(indexContent).toContain('import instantlyRoutes from "./routes/instantly.js"');
    expect(indexContent).toContain('app.use("/v1", instantlyRoutes)');
  });

  it("registers the OpenAPI path with passthrough response + platform auth", () => {
    expect(schemaContent).toContain('path: "/v1/instantly/audit/sending-forecast"');
    expect(schemaContent).toContain('InstantlySendingForecastResponse');
    expect(schemaContent).toContain("security: platformAuth");
  });
});

describe("Instantly account-health audit proxy route (source)", () => {
  it("should have GET /instantly/audit/account-health route", () => {
    expect(content).toContain('"/instantly/audit/account-health"');
    expect(content).toContain("router.get");
  });

  it("forwards to instantly-service downstream path verbatim", () => {
    expect(content).toContain("externalServices.instantly");
    expect(content).toContain('"/internal/audit/account-health"');
  });

  it("is staff-gated with authenticatePlatform + requireStaff (no org)", () => {
    const mountIdx = content.indexOf('"/instantly/audit/account-health"');
    const chain = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(chain).toContain("authenticatePlatform,");
    expect(chain).toContain("requireStaff,");
    expect(chain).not.toContain("requireOrg");
  });

  it("registers the OpenAPI path with passthrough response + platform auth", () => {
    expect(schemaContent).toContain('path: "/v1/instantly/audit/account-health"');
    expect(schemaContent).toContain('InstantlyAccountHealthResponse');
    expect(schemaContent).toContain("security: platformAuth");
  });
});

describe("Instantly capacity-history audit proxy route (source)", () => {
  it("should have GET /instantly/audit/capacity-history route", () => {
    expect(content).toContain('"/instantly/audit/capacity-history"');
    expect(content).toContain("router.get");
  });

  it("forwards to instantly-service downstream path verbatim", () => {
    expect(content).toContain("externalServices.instantly");
    expect(content).toContain("/internal/audit/capacity-history");
  });

  it("forwards the optional days query param through", () => {
    const mountIdx = content.indexOf('"/instantly/audit/capacity-history"');
    const handler = content.slice(mountIdx, mountIdx + 700);
    expect(handler).toContain("req.query.days");
    expect(handler).toContain('params.set("days"');
  });

  it("is staff-gated with authenticatePlatform + requireStaff (no org)", () => {
    const mountIdx = content.indexOf('"/instantly/audit/capacity-history"');
    const chain = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(chain).toContain("authenticatePlatform,");
    expect(chain).toContain("requireStaff,");
    expect(chain).not.toContain("requireOrg");
  });

  it("registers the OpenAPI path with passthrough response + platform auth", () => {
    expect(schemaContent).toContain('path: "/v1/instantly/audit/capacity-history"');
    expect(schemaContent).toContain('InstantlyCapacityHistoryResponse');
    const mountIdx = schemaContent.indexOf('path: "/v1/instantly/audit/capacity-history"');
    const block = schemaContent.slice(mountIdx, mountIdx + 1400);
    expect(block).toContain("security: platformAuth");
  });
});

describe("Instantly reconcile audit proxy route (source)", () => {
  it("should have GET /instantly/audit/reconcile route", () => {
    expect(content).toContain('"/instantly/audit/reconcile"');
    expect(content).toContain("router.get");
  });

  it("forwards to instantly-service downstream path verbatim", () => {
    expect(content).toContain("externalServices.instantly");
    expect(content).toContain('"/internal/audit/reconcile"');
  });

  it("is staff-gated with authenticatePlatform + requireStaff (no org)", () => {
    const mountIdx = content.indexOf('"/instantly/audit/reconcile"');
    const chain = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(chain).toContain("authenticatePlatform,");
    expect(chain).toContain("requireStaff,");
    expect(chain).not.toContain("requireOrg");
  });

  it("registers the OpenAPI path with passthrough response + platform auth", () => {
    expect(schemaContent).toContain('path: "/v1/instantly/audit/reconcile"');
    expect(schemaContent).toContain('InstantlyReconcileResponse');
    expect(schemaContent).toContain("security: platformAuth");
  });
});

