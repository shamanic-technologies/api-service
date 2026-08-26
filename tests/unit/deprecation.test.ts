import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import {
  DEPRECATION_POLICY,
  MINIMUM_NOTICE_DAYS,
  honoursMinimumNotice,
  signalDeprecation,
} from "../../src/lib/deprecation.js";

describe("deprecation policy", () => {
  it("promises a notice period an agent can plan against", () => {
    expect(MINIMUM_NOTICE_DAYS).toBeGreaterThanOrEqual(90);
    expect(DEPRECATION_POLICY.minimumNoticeDays).toBe(MINIMUM_NOTICE_DAYS);
    expect(DEPRECATION_POLICY.versioning).toBe("url-path");
  });

  it("checks a notice against the published floor", () => {
    const deprecatedAt = new Date("2026-09-01T00:00:00Z");
    const tooSoon = new Date("2026-10-01T00:00:00Z");
    const enough = new Date("2027-06-01T00:00:00Z");
    expect(honoursMinimumNotice({ deprecatedAt, sunsetAt: tooSoon })).toBe(false);
    expect(honoursMinimumNotice({ deprecatedAt, sunsetAt: enough })).toBe(true);
  });
});

describe("signalDeprecation", () => {
  function appWithDeprecatedRoute(link?: string) {
    const app = express();
    app.get("/old", (_req, res) => {
      signalDeprecation(res, {
        deprecatedAt: new Date("2026-09-01T00:00:00Z"),
        sunsetAt: new Date("2027-06-01T00:00:00Z"),
        link,
      });
      res.json({ ok: true });
    });
    return app;
  }

  it("emits RFC 9745 Deprecation, RFC 8594 Sunset and a deprecation Link", async () => {
    const res = await request(appWithDeprecatedRoute("https://api.distribute.you/docs#new")).get("/old");

    expect(res.status).toBe(200);
    expect(res.headers["deprecation"]).toBe(`@${Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000)}`);
    expect(res.headers["sunset"]).toBe(new Date("2027-06-01T00:00:00Z").toUTCString());
    expect(res.headers["link"]).toBe('<https://api.distribute.you/docs#new>; rel="deprecation"');
  });

  it("falls back to the policy page when no replacement is named", async () => {
    const res = await request(appWithDeprecatedRoute()).get("/old");
    expect(res.headers["link"]).toContain('rel="deprecation"');
    expect(res.headers["link"]).toContain(DEPRECATION_POLICY.policyUrl);
  });

  it("does not change the response body of the operation it marks", async () => {
    const res = await request(appWithDeprecatedRoute()).get("/old");
    expect(res.body).toEqual({ ok: true });
  });
});

describe("no operation is deprecated today", () => {
  it("matches the claim the OpenAPI description makes", async () => {
    const spec = await import("../../openapi.json");
    const methods = ["get", "post", "put", "patch", "delete"] as const;
    const deprecated: string[] = [];
    for (const [path, item] of Object.entries(spec.default.paths as Record<string, any>)) {
      for (const method of methods) {
        if (item[method]?.deprecated) deprecated.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(deprecated).toEqual([]);
  });
});
