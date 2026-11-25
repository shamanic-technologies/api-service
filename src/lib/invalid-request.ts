import type { z } from "zod";

/**
 * The 400 a route answers when the gateway's own Zod check refuses a request (AGENT-SIGNUP-UX-1125).
 *
 * `error` NAMES the offending field(s) and what was expected, on one line: an outside agent and our call-log
 * Telegram show only that line, and `"Invalid request"` alone sent a prospect's agent guessing (2026-11-25).
 * `code` is stable for branching; `details` (zod `flatten()`) is kept byte-identical for existing readers.
 *
 *   {"error":"Invalid request: url: Invalid url; name: Expected string, received number","code":"invalid_request",
 *    "fields":["url","name"],"details":{"formErrors":[],"fieldErrors":{...}}}
 */
export function invalidRequestBody(error: z.ZodError, what = "Invalid request") {
  const problems = error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  const fields = [...new Set(error.issues.map((issue) => issue.path.map(String).join(".")).filter(Boolean))];
  return {
    error: problems.length ? `${what}: ${problems.join("; ")}` : what,
    code: "invalid_request",
    fields,
    details: error.flatten(),
  };
}
