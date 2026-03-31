import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/articles.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Articles proxy routes", () => {
  // ── Articles CRUD ─────────────────────────────────────────────────────

  it("should have GET /articles with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/articles"') && !l.includes("/:id") && !l.includes("/authors")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward limit and offset on GET /articles", () => {
    expect(content).toContain('"limit"');
    expect(content).toContain('"offset"');
  });

  it("should have POST /articles with auth", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/articles"') && !l.includes("/bulk") && !l.includes("/search")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
  });

  it("should have POST /articles/bulk with auth", () => {
    expect(content).toContain('"/articles/bulk"');
  });

  it("should have POST /articles/search with auth", () => {
    expect(content).toContain('"/articles/search"');
  });

  it("should have GET /articles/authors with auth", () => {
    expect(content).toContain('"/articles/authors"');
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/articles/authors"')
    );
    expect(line).toContain("authenticate");
  });

  it("should have GET /articles/:id with auth", () => {
    expect(content).toContain('"/articles/:id"');
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/articles/:id"')
    );
    expect(line).toContain("authenticate");
  });

  it("should register static routes before parameterized :id route", () => {
    const authorsIdx = content.indexOf('"/articles/authors"');
    const bulkIdx = content.indexOf('"/articles/bulk"');
    const searchIdx = content.indexOf('"/articles/search"');
    const statsIdx = content.indexOf('"/articles/stats"');
    const idIdx = content.indexOf('"/articles/:id"');
    expect(authorsIdx).toBeLessThan(idIdx);
    expect(bulkIdx).toBeLessThan(idIdx);
    expect(searchIdx).toBeLessThan(idIdx);
    expect(statsIdx).toBeLessThan(idIdx);
  });

  it("should have GET /articles/stats with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/articles/stats"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should proxy GET /articles/stats to /v1/stats on articles-service", () => {
    expect(content).toContain('`/v1/stats${qs}`');
  });

  it("should forward all filter params on GET /articles/stats", () => {
    const statsBlock = content.slice(
      content.indexOf('"/articles/stats"'),
      content.indexOf('"/articles/stats"') + 600
    );
    for (const param of ["orgId", "brandId", "campaignId", "workflowSlug", "featureSlug", "workflowDynastySlug", "featureDynastySlug", "groupBy"]) {
      expect(statsBlock).toContain(`"${param}"`);
    }
  });

  // ── Topics ────────────────────────────────────────────────────────────

  it("should have GET /topics with auth", () => {
    expect(content).toContain('"/topics"');
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/topics"')
    );
    expect(line).toContain("authenticate");
  });

  it("should have POST /topics with auth", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/topics"') && !l.includes("/bulk")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
  });

  it("should have POST /topics/bulk with auth", () => {
    expect(content).toContain('"/topics/bulk"');
  });

  // ── Discoveries ───────────────────────────────────────────────────────

  it("should have GET /discoveries with auth and filter params", () => {
    expect(content).toContain('"/discoveries"');
    const section = content.slice(content.indexOf('router.get("/discoveries"'));
    expect(section).toContain('"brandId"');
    expect(section).toContain('"campaignId"');
    expect(section).toContain('"outletId"');
    expect(section).toContain('"journalistId"');
    expect(section).toContain('"topicId"');
  });

  it("should have POST /discoveries with auth", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/discoveries"') && !l.includes("/bulk")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
  });

  it("should have POST /discoveries/bulk with auth", () => {
    expect(content).toContain('"/discoveries/bulk"');
  });

  // ── Discovery workflows ───────────────────────────────────────────────

  it("should have POST /discover/outlet-articles with auth", () => {
    expect(content).toContain('"/discover/outlet-articles"');
  });

  it("should have POST /discover/journalist-publications with auth", () => {
    expect(content).toContain('"/discover/journalist-publications"');
  });

  // ── General checks ────────────────────────────────────────────────────

  it("should proxy to articles-service at /v1/ paths (articles-service uses /v1 prefix)", () => {
    // All callExternalService calls should target /v1/... on the articles service
    const calls = content.match(/`\/v1\//g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBeGreaterThanOrEqual(3);
    // Verify we're calling externalServices.articles
    expect(content).toContain("externalServices.articles");
  });

  it("should use buildInternalHeaders for all endpoints", () => {
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(15);
  });

  it("should enforce requireOrg + requireUser on ALL article routes", () => {
    const routeLines = content.split("\n").filter((l) =>
      /router\.(get|post)\(/.test(l) && l.includes('"/')
    );
    expect(routeLines.length).toBeGreaterThan(0);
    for (const line of routeLines) {
      expect(line).toContain("authenticate");
      expect(line).toContain("requireOrg");
      expect(line).toContain("requireUser");
    }
  });
});

describe("Articles service client", () => {
  it("should have articles in externalServices", () => {
    expect(serviceClientContent).toContain("articles:");
    expect(serviceClientContent).toContain("ARTICLES_SERVICE_URL");
    expect(serviceClientContent).toContain("ARTICLES_SERVICE_API_KEY");
  });
});

describe("Articles OpenAPI schemas", () => {
  it("should register GET /v1/articles", () => {
    expect(schemaContent).toContain('path: "/v1/articles"');
  });

  it("should register POST /v1/articles", () => {
    expect(schemaContent).toContain("CreateArticleRequest");
  });

  it("should register GET /v1/articles/authors", () => {
    expect(schemaContent).toContain('path: "/v1/articles/authors"');
  });

  it("should register GET /v1/articles/{id}", () => {
    expect(schemaContent).toContain('path: "/v1/articles/{id}"');
  });

  it("should register POST /v1/articles/bulk", () => {
    expect(schemaContent).toContain('path: "/v1/articles/bulk"');
    expect(schemaContent).toContain("BulkCreateArticlesRequest");
  });

  it("should register POST /v1/articles/search", () => {
    expect(schemaContent).toContain('path: "/v1/articles/search"');
    expect(schemaContent).toContain("SearchArticlesRequest");
  });

  it("should register GET /v1/topics", () => {
    expect(schemaContent).toContain('path: "/v1/topics"');
  });

  it("should register POST /v1/topics", () => {
    expect(schemaContent).toContain("CreateTopicRequest");
  });

  it("should register POST /v1/topics/bulk", () => {
    expect(schemaContent).toContain('path: "/v1/topics/bulk"');
    expect(schemaContent).toContain("BulkCreateTopicsRequest");
  });

  it("should register GET /v1/discoveries", () => {
    expect(schemaContent).toContain('path: "/v1/discoveries"');
  });

  it("should register POST /v1/discoveries", () => {
    expect(schemaContent).toContain("CreateDiscoveryRequest");
  });

  it("should register POST /v1/discoveries/bulk", () => {
    expect(schemaContent).toContain('path: "/v1/discoveries/bulk"');
    expect(schemaContent).toContain("BulkCreateDiscoveriesRequest");
  });

  it("should register POST /v1/discover/outlet-articles", () => {
    expect(schemaContent).toContain('path: "/v1/discover/outlet-articles"');
    expect(schemaContent).toContain("DiscoverOutletArticlesRequest");
  });

  it("should register POST /v1/discover/journalist-publications", () => {
    expect(schemaContent).toContain('path: "/v1/discover/journalist-publications"');
    expect(schemaContent).toContain("DiscoverJournalistPublicationsRequest");
  });

  it("should include optional outletDomain in DiscoverJournalistPublicationsRequest schema", () => {
    // outletDomain must be present and optional in the journalist-publications request schema
    const line = schemaContent.split("\n").find((l) => l.includes("outletDomain") && l.includes("optional"));
    expect(line).toBeDefined();
  });

  it("should register GET /v1/articles/stats", () => {
    expect(schemaContent).toContain('path: "/v1/articles/stats"');
    expect(schemaContent).toContain("ArticleStatsResponse");
  });

  it("should use Articles tag", () => {
    expect(schemaContent).toContain('tags: ["Articles"]');
  });
});

describe("Articles routes are mounted in index.ts", () => {
  it("should import and mount articles routes", () => {
    expect(indexContent).toContain("articlesRoutes");
    expect(indexContent).toContain("./routes/articles");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", articlesRoutes)');
  });
});
