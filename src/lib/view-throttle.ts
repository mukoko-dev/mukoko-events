import "server-only";

/**
 * Coarse abuse cap for recording page views (`trackEventViewAction`).
 *
 * The action is public and posts with Mukoko Events' own service token, so
 * without a cap a loop could inflate views or burn the key's rate limit that
 * other reads share. This is only a ceiling, set well above what real people
 * produce, so it never undercounts a crowd behind one carrier address (CGNAT):
 * at most {@link PER_SOURCE_PER_MINUTE} recorded views a minute per source.
 * Repeat views from one browser are de-duplicated in the browser
 * (`EventViewTracker`), not here.
 *
 * A source is an IPv4 address or an IPv6 /64 (one home or host gets a whole
 * /64, so rotating within it gains nothing). Per server instance, in memory:
 * the key is a SHA-256, never sent to the API, logged or stored.
 */

import { createHash } from "node:crypto";

export const PER_SOURCE_PER_MINUTE = 120;
const MAX_ENTRIES = 10_000;

const buckets = new Map<string, { start: number; count: number }>();

/** IPv4 as is; IPv6 cut to its /64 (the first four hextets, `::` expanded). */
export function sourceOf(address: string): string {
  const ip = address.trim().toLowerCase();
  if (!ip.includes(":")) return ip || "unknown";
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return v4mapped[1];
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const full = ip.includes("::")
    ? [
        ...left,
        ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"),
        ...right,
      ]
    : left;
  return `${full
    .slice(0, 4)
    .map((h) => h.replace(/^0+(?=.)/, "") || "0")
    .join(":")}::/64`;
}

/** True when this view may be recorded; false over the source's cap. */
export function allowView(address: string, now: number = Date.now()): boolean {
  const key = createHash("sha256").update(sourceOf(address)).digest("hex");
  const bucket = buckets.get(key);
  if (bucket && now - bucket.start < 60_000) {
    if (bucket.count >= PER_SOURCE_PER_MINUTE) return false;
    bucket.count += 1;
    return true;
  }
  buckets.delete(key);
  buckets.set(key, { start: now, count: 1 });
  while (buckets.size > MAX_ENTRIES) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
  return true;
}

/** Test hook: forget everything. */
export function __resetViewThrottle(): void {
  buckets.clear();
}
