import "server-only";

/**
 * A daily, pseudonymous visitor key for idempotent view counting.
 *
 * `POST /v1/analytics/views` takes a `visitor_key`; the API derives the view's
 * id from (subject, visitor_key, UTC date), so repeats collapse to one view
 * per visitor per subject per day. Spam can't inflate counts, nothing in the
 * app fills up, and no one can suppress another visitor's views.
 *
 * key = HMAC-SHA256(VIEW_VISITOR_KEY_SECRET, identity + "|" + UTC date),
 * truncated to 32 hex characters. The identity is the signed-in person's
 * WorkOS id when there is one, else the trusted client IP plus a coarse
 * browser family. The raw inputs are never sent, logged or stored, and the
 * date rotates the key daily so it is not a long-lived tracker.
 *
 * No secret, or no trusted identity: null, and the view is not recorded.
 */

import { createHmac } from "node:crypto";

/** A coarse browser family: enough to tell people behind one address apart, too coarse to fingerprint. */
export function uaFamily(ua: string | null | undefined): string {
  const s = (ua ?? "").slice(0, 512).toLowerCase();
  const mobile = /mobile|android|iphone|ipad/.test(s) ? "m" : "d";
  const family = s.includes("edg/")
    ? "edge"
    : s.includes("firefox/")
      ? "firefox"
      : s.includes("chrome/") || s.includes("crios/")
        ? "chrome"
        : s.includes("safari/")
          ? "safari"
          : "other";
  return `${family}-${mobile}`;
}

export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function visitorKey(
  input:
    | { kind: "person"; personId: string }
    | { kind: "anonymous"; ip: string; userAgent?: string | null },
  {
    secret = process.env.VIEW_VISITOR_KEY_SECRET,
    now = new Date(),
  }: { secret?: string; now?: Date } = {},
): string | null {
  const key = secret?.trim();
  if (!key) return null;
  const identity =
    input.kind === "person"
      ? input.personId
        ? `p:${input.personId}`
        : ""
      : input.ip
        ? `a:${input.ip}|${uaFamily(input.userAgent)}`
        : "";
  if (!identity) return null;
  return createHmac("sha256", key)
    .update(`${identity}|${utcDate(now)}`)
    .digest("hex")
    .slice(0, 32);
}
