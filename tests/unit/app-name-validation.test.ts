import { describe, it, expect } from "vitest";
import { RegisterAppRequestSchema } from "../../src/schemas.js";

describe("RegisterAppRequestSchema name validation", () => {
  const valid = [
    "pressbeat-io",
    "my-app",
    "acme",
    "app-123",
  ];

  const invalid = [
    "PressBeat.io",
    "My Cool App",
    "UPPERCASE",
    "has_underscore",
    "has.dot",
    "",
  ];

  for (const name of valid) {
    it(`accepts "${name}"`, () => {
      expect(RegisterAppRequestSchema.safeParse({ name }).success).toBe(true);
    });
  }

  for (const name of invalid) {
    it(`rejects "${name}"`, () => {
      const result = RegisterAppRequestSchema.safeParse({ name });
      expect(result.success).toBe(false);
    });
  }
});
