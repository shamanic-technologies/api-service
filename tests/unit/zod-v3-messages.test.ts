import { describe, it, expect } from "vitest";
import { z } from "zod";
import { z as z3 } from "zod/v3";
import "../../src/lib/zod-v3-messages.js";
import { CreateCampaignRequestSchema, QualifyRequestSchema } from "../../src/schemas.js";

// Routes return `parsed.error.flatten()` to callers, so the zod 4 upgrade must keep
// zod 3's default messages. Each case builds the same schema in both majors and
// asserts the flattened error is identical.
type Case = [string, () => unknown, () => unknown, unknown];

const cases: Case[] = [
  ["missing required key", () => z.object({ a: z.string() }), () => z3.object({ a: z3.string() }), {}],
  ["wrong type", () => z.object({ a: z.string() }), () => z3.object({ a: z3.string() }), { a: 1 }],
  ["null for string", () => z.object({ a: z.string() }), () => z3.object({ a: z3.string() }), { a: null }],
  ["array for object", () => z.object({ a: z.object({}) }), () => z3.object({ a: z3.object({}) }), { a: [] }],
  ["non-integer", () => z.object({ a: z.number().int() }), () => z3.object({ a: z3.number().int() }), { a: 1.5 }],
  ["coerced NaN", () => z.object({ a: z.coerce.number() }), () => z3.object({ a: z3.coerce.number() }), { a: "abc" }],
  ["string min", () => z.object({ a: z.string().min(1) }), () => z3.object({ a: z3.string().min(1) }), { a: "" }],
  ["string max", () => z.object({ a: z.string().max(3) }), () => z3.object({ a: z3.string().max(3) }), { a: "abcd" }],
  ["string length", () => z.object({ a: z.string().length(3) }), () => z3.object({ a: z3.string().length(3) }), { a: "ab" }],
  ["number min", () => z.object({ a: z.number().min(1) }), () => z3.object({ a: z3.number().min(1) }), { a: 0 }],
  ["number positive", () => z.object({ a: z.number().positive() }), () => z3.object({ a: z3.number().positive() }), { a: 0 }],
  ["number max", () => z.object({ a: z.number().max(100) }), () => z3.object({ a: z3.number().max(100) }), { a: 101 }],
  ["number lt", () => z.object({ a: z.number().lt(5) }), () => z3.object({ a: z3.number().lt(5) }), { a: 5 }],
  ["array min", () => z.object({ a: z.array(z.string()).min(1) }), () => z3.object({ a: z3.array(z3.string()).min(1) }), { a: [] }],
  ["array max", () => z.object({ a: z.array(z.string()).max(1) }), () => z3.object({ a: z3.array(z3.string()).max(1) }), { a: ["x", "y"] }],
  ["enum", () => z.object({ a: z.enum(["x", "y"]) }), () => z3.object({ a: z3.enum(["x", "y"]) }), { a: "z" }],
  ["literal", () => z.object({ a: z.literal("x") }), () => z3.object({ a: z3.literal("x") }), { a: "z" }],
  ["email", () => z.object({ a: z.string().email() }), () => z3.object({ a: z3.string().email() }), { a: "nope" }],
  ["url", () => z.object({ a: z.string().url() }), () => z3.object({ a: z3.string().url() }), { a: "nope" }],
  ["uuid", () => z.object({ a: z.string().uuid() }), () => z3.object({ a: z3.string().uuid() }), { a: "nope" }],
  ["datetime", () => z.object({ a: z.string().datetime() }), () => z3.object({ a: z3.string().datetime() }), { a: "nope" }],
  ["regex", () => z.object({ a: z.string().regex(/^a$/) }), () => z3.object({ a: z3.string().regex(/^a$/) }), { a: "b" }],
  ["startsWith", () => z.object({ a: z.string().startsWith("x") }), () => z3.object({ a: z3.string().startsWith("x") }), { a: "b" }],
  ["union", () => z.object({ a: z.union([z.string(), z.number()]) }), () => z3.object({ a: z3.union([z3.string(), z3.number()]) }), { a: true }],
  ["strict", () => z.object({ a: z.string() }).strict(), () => z3.object({ a: z3.string() }).strict(), { a: "x", b: 1, c: 2 }],
  ["refine", () => z.object({ a: z.string() }).refine(() => false), () => z3.object({ a: z3.string() }).refine(() => false), { a: "x" }],
  ["custom message wins", () => z.object({ a: z.string().min(1, "a is required") }), () => z3.object({ a: z3.string().min(1, "a is required") }), { a: "" }],
  ["record values", () => z.object({ a: z.record(z.string(), z.string()) }), () => z3.object({ a: z3.record(z3.string()) }), { a: { k: 1 } }],
];

describe("zod 4 keeps zod 3 validation messages", () => {
  for (const [name, v4, v3, input] of cases) {
    it(name, () => {
      const r4 = (v4() as z.ZodType).safeParse(input);
      const r3 = (v3() as z3.ZodTypeAny).safeParse(input);
      expect(r4.success).toBe(false);
      expect(r3.success).toBe(false);
      expect(r4.error!.flatten()).toEqual(r3.error!.flatten());
    });
  }

  it("a real route schema answers zod 3 wording", () => {
    const r = QualifyRequestSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors).toMatchObject({ fromEmail: ["Required"] });
    const c = CreateCampaignRequestSchema.safeParse("nope");
    expect(c.success).toBe(false);
    expect(c.error!.flatten().formErrors).toEqual(["Expected object, received string"]);
  });
});
