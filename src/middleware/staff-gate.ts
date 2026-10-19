import type { NextFunction, Response } from "express";
import { authenticatePlatform, authenticateUser, requireStaff, requireStaffActor, AuthenticatedRequest } from "./auth.js";

/**
 * Staff gate for a fleet-wide staff route that needs NO org: a Bearer key with no X-API-Key
 * = a person's own key, staff only (`authenticateUser` + `requireStaffActor`); anything else
 * takes the platform path the dashboard uses (`authenticatePlatform` + `requireStaff`), which
 * needs no identity headers. Use it ONLY on operations listed in `STAFF_KEY_OPERATIONS`.
 */
export function requireStaffKeyOrPlatform(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.headers.authorization && !req.headers["x-api-key"]) {
    return void authenticateUser(req, res, () => requireStaffActor(req, res, next));
  }
  return void authenticatePlatform(req, res, () => requireStaff(req, res, next));
}
