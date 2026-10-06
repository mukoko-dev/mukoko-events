import "server-only";

/**
 * Best-effort throttle for recording page views (`trackEventViewAction`).
 *
 * The action is public and posts with Mukoko Events' own service token, so
 * without a gate anyone could loop it to inflate views, or burn the key's
 * rate limit that other reads share. Per server instance (memory only):
 * - one view per visitor per event per {@link SAME_VIEW_MS}, and
 * - at most {@link PER_VISITOR_PER_MINUTE} recorded views per visitor a minute.
 *
 * The visitor key is a SHA-256 of the client address, held in memory only:
 * never sent to the API, logged or stored.
 */

import { createHash } from "node:crypto";

export const SAME_VIEW_MS = 30 * 60_000;
export const PER_VISITOR_PER_MINUTE = 20;
const MAX_ENTRIES = 10_000;

const lastView = new Map<string, number>();
const perMinute = new Map<string, { start: number; count: number }>();

function visitorKey(address: string): string {
  return createHash("sha256").update(address).digest("hex");
}

function trim<V>(map: Map<string, V>): void {
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** True when this view should be recorded; false when it is a repeat or over the cap. */
export function allowView(
  address: string,
  eventId: string,
  now: number = Date.now(),
): boolean {
  const visitor = visitorKey(address || "unknown");
  const key = `${visitor}:${eventId}`;
  const seen = lastView.get(key);
  if (seen !== undefined && now - seen < SAME_VIEW_MS) return false;

  const bucket = perMinute.get(visitor);
  if (bucket && now - bucket.start < 60_000) {
    if (bucket.count >= PER_VISITOR_PER_MINUTE) return false;
    bucket.count += 1;
  } else {
    perMinute.delete(visitor);
    perMinute.set(visitor, { start: now, count: 1 });
  }

  lastView.delete(key);
  lastView.set(key, now);
  trim(lastView);
  trim(perMinute);
  return true;
}

/** Test hook: forget everything. */
export function __resetViewThrottle(): void {
  lastView.clear();
  perMinute.clear();
}
