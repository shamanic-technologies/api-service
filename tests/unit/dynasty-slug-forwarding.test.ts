import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const featuresRoute = fs.readFileSync(path.join(__dirname, "../../src/routes/features.ts"), "utf-8");
const outletsRoute = fs.readFileSync(path.join(__dirname, "../../src/routes/outlets.ts"), "utf-8");
const runsRoute = fs.readFileSync(path.join(__dirname, "../../src/routes/runs.ts"), "utf-8");
const emailGatewayRoute = fs.readFileSync(path.join(__dirname, "../../src/routes/email-gateway.ts"), "utf-8");
const emailsRoute = fs.readFileSync(path.join(__dirname, "../../src/routes/emails.ts"), "utf-8");
const stripeRoute = fs.readFileSync(path.join(__dirname, "../../src/routes/stripe.ts"), "utf-8");
const campaignsRoute = fs.readFileSync(path.join(__dirname, "../../src/routes/campaigns.ts"), "utf-8");
const deliveryStatsLib = fs.readFileSync(path.join(__dirname, "../../src/lib/delivery-stats.ts"), "utf-8");
const schemaContent = fs.readFileSync(path.join(__dirname, "../../src/schemas.ts"), "utf-8");
const openapiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../openapi.json"), "utf-8"));

const dynastyParams = ["workflowDynastySlug", "featureDynastySlug"];
const allSlugParams = ["workflowSlug", "featureSlug", "workflowDynastySlug", "featureDynastySlug"];

describe("Dynasty slug forwarding — features/stats", () => {
  it("should forward featureDynastySlug but NOT workflowDynastySlug on GET /features/stats", () => {
    const statsSection = featuresRoute.slice(
      featuresRoute.indexOf('"/features/stats"'),
      featuresRoute.indexOf('"/features/dynasty"'),
    );
    expect(statsSection).toContain('"featureDynastySlug"');
    expect(statsSection).not.toContain('"workflowDynastySlug"');
    // Also forwards featureSlug + workflowSlug filters
    expect(statsSection).toContain('"featureSlug"');
    expect(statsSection).toContain('"workflowSlug"');
  });

  it("should forward featureDynastySlug but NOT workflowDynastySlug on GET /features/:slug/stats", () => {
    const slugStatsSection = featuresRoute.slice(
      featuresRoute.indexOf('"/features/:slug/stats"'),
    );
    expect(slugStatsSection).toContain('"featureDynastySlug"');
    expect(slugStatsSection).not.toContain('"workflowDynastySlug"');
  });
});

describe("Dynasty slug forwarding — outlets/stats", () => {
  it("should forward dynasty slug filters on GET /outlets/stats", () => {
    const statsSection = outletsRoute.slice(
      outletsRoute.indexOf('"/outlets/stats"'),
      outletsRoute.indexOf('"/outlets"', outletsRoute.indexOf('"/outlets/stats"') + 20),
    );
    for (const param of [...dynastyParams, "featureSlug"]) {
      expect(statsSection).toContain(`"${param}"`);
    }
  });
});

describe("Dynasty slug forwarding — runs/stats/costs", () => {
  it("should forward dynasty slug filters on GET /runs/stats/costs", () => {
    for (const param of [...dynastyParams, "workflowSlug", "featureSlug"]) {
      expect(runsRoute).toContain(`"${param}"`);
    }
  });
});

describe("Dynasty slug forwarding — email-gateway/stats", () => {
  it("should forward dynasty slug filters on GET /email-gateway/stats", () => {
    for (const param of allSlugParams) {
      expect(emailGatewayRoute).toContain(`"${param}"`);
    }
  });

  it("should accept dynasty slug filters in fetchDeliveryStats", () => {
    for (const param of allSlugParams) {
      expect(deliveryStatsLib).toContain(param);
    }
  });
});

describe("Dynasty slug forwarding — emails/stats", () => {
  it("should forward dynasty slug filters on GET /emails/stats", () => {
    const statsSection = emailsRoute.slice(emailsRoute.indexOf('"/emails/stats"'));
    for (const param of allSlugParams) {
      expect(statsSection).toContain(`"${param}"`);
    }
  });
});

describe("Dynasty slug forwarding — stripe/stats", () => {
  it("should forward dynasty slug filters on GET /stripe/stats", () => {
    const statsSection = stripeRoute.slice(stripeRoute.indexOf('"/stripe/stats"'));
    for (const param of allSlugParams) {
      expect(statsSection).toContain(`"${param}"`);
    }
  });
});

describe("Dynasty slug forwarding — campaigns/stats", () => {
  it("should forward dynasty slug filters on GET /campaigns/stats downstream calls", () => {
    const statsSection = campaignsRoute.slice(
      campaignsRoute.indexOf('"/campaigns/stats"'),
      campaignsRoute.indexOf('"/campaigns/:id"'),
    );
    for (const param of allSlugParams) {
      expect(statsSection).toContain(`"${param}"`);
    }
  });
});

describe("Dynasty slug OpenAPI schemas", () => {
  it("should include dynasty slug filters in /v1/outlets/stats query schema", () => {
    expect(schemaContent).toContain('featureDynastySlug: z.string().optional()');
    expect(schemaContent).toContain('workflowDynastySlug: z.string().optional()');
  });

  it("should include dynasty groupBy values in /v1/outlets/stats schema", () => {
    // The enum should include dynasty slugs
    const outletsStatsSection = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/outlets/stats"'),
      schemaContent.indexOf('path: "/v1/outlets/stats"') + 1200,
    );
    expect(outletsStatsSection).toContain('"workflowDynastySlug"');
    expect(outletsStatsSection).toContain('"featureDynastySlug"');
  });

  it("should include featureDynastySlug but NOT workflowDynastySlug in /v1/features/stats query schema", () => {
    const featuresStatsSection = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/features/stats"'),
      schemaContent.indexOf('path: "/v1/features/stats"') + 1200,
    );
    expect(featuresStatsSection).toContain("featureDynastySlug");
    expect(featuresStatsSection).not.toContain("workflowDynastySlug");
    expect(featuresStatsSection).toContain("featureSlug");
    expect(featuresStatsSection).toContain("workflowSlug");
  });

  it("should include featureDynastySlug but NOT workflowDynastySlug in /v1/features/{featureSlug}/stats query schema", () => {
    const start = schemaContent.indexOf('path: "/v1/features/{featureSlug}/stats"');
    const featureSlugStatsSection = schemaContent.slice(start, start + 1200);
    expect(featureSlugStatsSection).toContain("featureDynastySlug");
    expect(featureSlugStatsSection).not.toContain("workflowDynastySlug");
  });

  it("should include dynasty slug filters in /v1/runs/stats/costs query schema", () => {
    const runsStatsSection = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/runs/stats/costs"'),
      schemaContent.indexOf('path: "/v1/runs/stats/costs"') + 1200,
    );
    expect(runsStatsSection).toContain("featureDynastySlug");
    expect(runsStatsSection).toContain("workflowDynastySlug");
    expect(runsStatsSection).toContain("featureSlug");
    expect(runsStatsSection).toContain("workflowSlug");
  });

  it("should include dynasty slug filters in /v1/email-gateway/stats query schema", () => {
    const section = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/email-gateway/stats"'),
      schemaContent.indexOf('path: "/v1/email-gateway/stats"') + 1200,
    );
    for (const param of allSlugParams) {
      expect(section).toContain(param);
    }
  });

  it("should include dynasty slug filters in /v1/emails/stats query schema", () => {
    const section = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/emails/stats"'),
      schemaContent.indexOf('path: "/v1/emails/stats"') + 1200,
    );
    for (const param of allSlugParams) {
      expect(section).toContain(param);
    }
  });

  it("should include dynasty slug filters in /v1/stripe/stats query schema", () => {
    const section = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/stripe/stats"'),
      schemaContent.indexOf('path: "/v1/stripe/stats"') + 1200,
    );
    for (const param of allSlugParams) {
      expect(section).toContain(param);
    }
  });

  it("should include dynasty slug filters in /v1/campaigns/stats query schema", () => {
    const section = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/campaigns/stats"'),
      schemaContent.indexOf('path: "/v1/campaigns/stats"') + 1500,
    );
    for (const param of allSlugParams) {
      expect(section).toContain(param);
    }
  });
});

describe("Dynasty slug params in generated openapi.json", () => {
  it("should have dynasty query params on /v1/outlets/stats", () => {
    const params = openapiSpec.paths["/v1/outlets/stats"]?.get?.parameters ?? [];
    const paramNames = params.map((p: { name: string }) => p.name);
    expect(paramNames).toContain("workflowDynastySlug");
    expect(paramNames).toContain("featureDynastySlug");
    expect(paramNames).toContain("featureSlug");
  });

  it("should have dynasty groupBy values on /v1/outlets/stats", () => {
    const params = openapiSpec.paths["/v1/outlets/stats"]?.get?.parameters ?? [];
    const groupByParam = params.find((p: { name: string }) => p.name === "groupBy");
    expect(groupByParam).toBeDefined();
    expect(groupByParam.schema.enum).toContain("workflowDynastySlug");
    expect(groupByParam.schema.enum).toContain("featureDynastySlug");
    expect(groupByParam.schema.enum).toContain("featureSlug");
  });

  it("should have featureDynastySlug but NOT workflowDynastySlug on /v1/features/stats", () => {
    const params = openapiSpec.paths["/v1/features/stats"]?.get?.parameters ?? [];
    const paramNames = params.map((p: { name: string }) => p.name);
    expect(paramNames).toContain("featureDynastySlug");
    expect(paramNames).not.toContain("workflowDynastySlug");
    expect(paramNames).toContain("featureSlug");
    expect(paramNames).toContain("workflowSlug");
  });

  it("should have featureDynastySlug but NOT workflowDynastySlug on /v1/features/{featureSlug}/stats", () => {
    const params = openapiSpec.paths["/v1/features/{featureSlug}/stats"]?.get?.parameters ?? [];
    const paramNames = params.map((p: { name: string }) => p.name);
    expect(paramNames).toContain("featureDynastySlug");
    expect(paramNames).not.toContain("workflowDynastySlug");
  });

  it("should have dynasty query params on /v1/runs/stats/costs", () => {
    const params = openapiSpec.paths["/v1/runs/stats/costs"]?.get?.parameters ?? [];
    const paramNames = params.map((p: { name: string }) => p.name);
    expect(paramNames).toContain("workflowDynastySlug");
    expect(paramNames).toContain("featureDynastySlug");
    expect(paramNames).toContain("workflowSlug");
    expect(paramNames).toContain("featureSlug");
  });

  it("should have dynasty query params on /v1/email-gateway/stats", () => {
    const params = openapiSpec.paths["/v1/email-gateway/stats"]?.get?.parameters ?? [];
    const paramNames = params.map((p: { name: string }) => p.name);
    for (const param of allSlugParams) {
      expect(paramNames).toContain(param);
    }
  });

  it("should have dynasty query params on /v1/emails/stats", () => {
    const params = openapiSpec.paths["/v1/emails/stats"]?.get?.parameters ?? [];
    const paramNames = params.map((p: { name: string }) => p.name);
    for (const param of allSlugParams) {
      expect(paramNames).toContain(param);
    }
  });

  it("should have dynasty query params on /v1/stripe/stats", () => {
    const params = openapiSpec.paths["/v1/stripe/stats"]?.get?.parameters ?? [];
    const paramNames = params.map((p: { name: string }) => p.name);
    for (const param of allSlugParams) {
      expect(paramNames).toContain(param);
    }
  });

  it("should have dynasty query params on /v1/campaigns/stats", () => {
    const params = openapiSpec.paths["/v1/campaigns/stats"]?.get?.parameters ?? [];
    const paramNames = params.map((p: { name: string }) => p.name);
    for (const param of allSlugParams) {
      expect(paramNames).toContain(param);
    }
  });
});
