import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const headersPath = path.join(__dirname, "../../src/lib/internal-headers.ts");
const content = fs.readFileSync(headersPath, "utf-8");

describe("buildInternalHeaders", () => {
  it("should include x-org-id always", () => {
    expect(content).toContain('"x-org-id"');
  });

  it("should include x-user-id when req.userId is set", () => {
    expect(content).toContain('"x-user-id"');
    expect(content).toContain("req.userId");
  });

  it("should NOT include x-app-id (removed)", () => {
    expect(content).not.toContain('"x-app-id"');
    expect(content).not.toContain("req.appId");
  });

  it("should NOT include x-key-source (removed)", () => {
    expect(content).not.toContain('"x-key-source"');
    expect(content).not.toContain("req.keySource");
  });
});
