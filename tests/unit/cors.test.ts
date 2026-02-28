import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("CORS configuration", () => {
  const indexSource = readFileSync(
    join(__dirname, "../../src/index.ts"),
    "utf-8",
  );

  const allowedOrigins = [
    "https://dashboard.distribute.you",
    "https://distribute.you",
    "https://performance.distribute.you",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3007",
  ];

  const blockedOrigins = [
    "https://dashboard.mcpfactory.org",
    "https://mcpfactory.org",
    "https://performance.mcpfactory.org",
  ];

  for (const origin of allowedOrigins) {
    it(`includes ${origin} in CORS origins`, () => {
      expect(indexSource).toContain(`"${origin}"`);
    });
  }

  for (const origin of blockedOrigins) {
    it(`does not include old domain ${origin} in CORS origins`, () => {
      expect(indexSource).not.toContain(`"${origin}"`);
    });
  }
});
