import type { Request } from "express";

/**
 * The origin FACTS a security alert carries (SECURITY-ALERTS-OURS-1128, owner 2026-11-28: « ne pas
 * envoyer ces alertes si ça vient de toi »). Whether an alert was caused by us is decided in ONE
 * place for every producer, transactional-email-service (`src/lib/security-origin.ts` there): it
 * records an alert caused by us for Monitoring and emails nobody. This service never decides it and
 * never skips raising an alert: it hands what it saw.
 *
 *  - originIp:     the edge client address when the request crossed the edge, else the TCP peer
 *                  (a docker address: a container inside the box).
 *  - originRelays: "true" when the request acts for someone else: a customer key, or a forwarded
 *                  session / org identity (the dashboard proxy and the MCP server call from inside
 *                  the box on behalf of customers; the 2026-11-20 traversal went through the
 *                  customer dashboard proxy). A box origin is then that person's act, not ours.
 *  - actorUserId:  the signed-in internal user, if any (our staff test accounts are ours).
 */
export interface AlertOriginFacts {
  originIp?: string;
  originRelays?: "true";
  actorUserId?: string;
}

const RELAYED_IDENTITY_HEADERS = ["authorization", "x-external-user-id", "x-external-org-id", "x-email", "x-org-id", "x-user-id"];

export function relaysSomeone(headers: Request["headers"], authType: "user_key" | "admin" | undefined): boolean {
  if (authType === "user_key") return true;
  return RELAYED_IDENTITY_HEADERS.some((h) => {
    const v = headers[h];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.trim() !== "";
  });
}

export function alertOriginFacts(
  req: Pick<Request, "headers" | "socket">,
  edgeIp: string | null,
  authType: "user_key" | "admin" | undefined,
  userId: string | undefined,
): AlertOriginFacts {
  const originIp = edgeIp ?? req.socket?.remoteAddress ?? undefined;
  return {
    ...(originIp ? { originIp } : {}),
    ...(relaysSomeone(req.headers, authType) ? { originRelays: "true" as const } : {}),
    ...(userId ? { actorUserId: userId } : {}),
  };
}
