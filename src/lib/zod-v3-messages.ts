import { z } from "zod";

/**
 * Keep the zod 3 wording of validation errors after the zod 4 upgrade.
 *
 * Routes answer a failed `safeParse` with `{ error, details: parsed.error.flatten() }`,
 * so the default issue messages are part of the API response. zod 4 rewrote them
 * ("Required" became "Invalid input: expected string, received undefined"); callers
 * (dashboard, MCP tools, LLM agents) read these strings, so the upgrade must not move
 * them. This maps every issue code zod 3 produced to its zod 3 default message; a
 * message set on the schema itself still wins (zod resolves per-schema errors first).
 * `tests/unit/zod-v3-messages.test.ts` pins each case against the real zod 3 output.
 */

function v3ParsedType(input: unknown): string {
  switch (typeof input) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(input) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(input)) return "array";
      if (input === null) return "null";
      if (input instanceof Promise) return "promise";
      if (input instanceof Map) return "map";
      if (input instanceof Set) return "set";
      if (input instanceof Date) return "date";
      return "object";
    default:
      return "unknown";
  }
}

function v3Value(v: unknown): string {
  return typeof v === "string" ? `'${v}'` : String(v);
}

const V3_FORMAT_NAMES: Record<string, string> = {
  regex: "",
  datetime: "datetime",
  date: "date",
  time: "time",
  duration: "duration",
  ipv4: "ip",
  ipv6: "ip",
  cidrv4: "cidr",
  cidrv6: "cidr",
};

type Issue = {
  code: string;
  input?: unknown;
  expected?: string;
  values?: unknown[];
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  exact?: boolean;
  format?: string;
  prefix?: string;
  suffix?: string;
  includes?: string;
  divisor?: number | bigint;
  keys?: string[];
  options?: unknown[];
  inst?: { _zod?: { def?: { type?: string } } };
};

function sizeMessage(
  issue: Issue,
  kind: "small" | "big",
): string | undefined {
  const n = kind === "small" ? issue.minimum : issue.maximum;
  const exact = issue.exact;
  const inclusive = issue.inclusive;
  switch (issue.origin) {
    case "array":
      if (exact) return `Array must contain exactly ${n} element(s)`;
      if (kind === "small")
        return `Array must contain ${inclusive ? "at least" : "more than"} ${n} element(s)`;
      return `Array must contain ${inclusive ? "at most" : "less than"} ${n} element(s)`;
    case "string":
      if (exact) return `String must contain exactly ${n} character(s)`;
      if (kind === "small")
        return `String must contain ${inclusive ? "at least" : "over"} ${n} character(s)`;
      return `String must contain ${inclusive ? "at most" : "under"} ${n} character(s)`;
    case "number":
    case "bigint": {
      // zod 3 said "Number" for a too-small bigint and "BigInt" for a too-big one.
      if (kind === "small")
        return `Number must be ${exact ? "exactly equal to" : inclusive ? "greater than or equal to" : "greater than"} ${n}`;
      const noun = issue.origin === "number" ? "Number" : "BigInt";
      return `${noun} must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${n}`;
    }
    case "date": {
      const d = new Date(Number(n));
      if (kind === "small")
        return `Date must be ${exact ? "exactly equal to" : inclusive ? "greater than or equal to" : "greater than"} ${d}`;
      return `Date must be ${exact ? "exactly" : inclusive ? "smaller than or equal to" : "smaller than"} ${d}`;
    }
    default:
      return undefined;
  }
}

export function zodV3Message(issue: Issue): string | undefined {
  switch (issue.code) {
    case "invalid_type": {
      const received = v3ParsedType(issue.input);
      if (received === "undefined") return "Required";
      if (issue.expected === "int") return "Expected integer, received float";
      return `Expected ${issue.expected}, received ${received}`;
    }
    case "invalid_value": {
      const values = issue.values ?? [];
      if (issue.inst?._zod?.def?.type === "literal" && values.length === 1)
        return `Invalid literal value, expected ${JSON.stringify(values[0])}`;
      return `Invalid enum value. Expected ${values.map(v3Value).join(" | ")}, received '${String(issue.input)}'`;
    }
    case "too_small":
      return sizeMessage(issue, "small");
    case "too_big":
      return sizeMessage(issue, "big");
    case "invalid_format": {
      if (issue.format === "starts_with") return `Invalid input: must start with "${issue.prefix}"`;
      if (issue.format === "ends_with") return `Invalid input: must end with "${issue.suffix}"`;
      if (issue.format === "includes") return `Invalid input: must include "${issue.includes}"`;
      if (issue.format === "regex") return "Invalid";
      const name = V3_FORMAT_NAMES[issue.format ?? ""] ?? issue.format;
      return `Invalid ${name}`;
    }
    case "not_multiple_of":
      return `Number must be a multiple of ${issue.divisor}`;
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${(issue.keys ?? []).map((k) => `'${k}'`).join(", ")}`;
    case "invalid_union":
      if (Array.isArray(issue.options) && issue.options.length > 0)
        return `Invalid discriminator value. Expected ${issue.options.map(v3Value).join(" | ")}`;
      return "Invalid input";
    case "custom":
      return "Invalid input";
    default:
      return undefined;
  }
}

z.config({ customError: (issue) => zodV3Message(issue as unknown as Issue) });
