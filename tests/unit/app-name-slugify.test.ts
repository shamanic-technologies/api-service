import { describe, it, expect } from "vitest";

/** Mirrors the slugify logic in src/routes/apps.ts */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

describe("App name slugification", () => {
  it("converts PressBeat.io to pressbeat-io", () => {
    expect(slugify("PressBeat.io")).toBe("pressbeat-io");
  });

  it("converts My Cool App! to my-cool-app", () => {
    expect(slugify("My Cool App!")).toBe("my-cool-app");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("foo---bar")).toBe("foo-bar");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("passes through already-valid names unchanged", () => {
    expect(slugify("my-app-123")).toBe("my-app-123");
  });

  it("handles uppercase-only input", () => {
    expect(slugify("ACME")).toBe("acme");
  });

  it("returns empty string for all-special-character input", () => {
    expect(slugify("...")).toBe("");
  });
});
