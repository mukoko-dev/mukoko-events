import "server-only";

/**
 * Abuse caps for recording page views (`trackEventViewAction`).
 *
 * The action is public and posts with Mukoko Events' own service token, so a
 * loop could inflate an event's views or burn the key's rate limit that other
 * reads share. Repeat views from one real browser are de-duplicated in the
 * browser (`EventViewTracker`); these are the server-side ceilings:
 *
 * - per source and event: {@link PER_SOURCE_PER_EVENT} per 10 minutes;
 * - per source: {@link PER_SOURCE_PER_MINUTE} a minute (the API's own
 *   anonymous allowance);
 * - per IPv6 /48: {@link PER_NETWORK_PER_MINUTE} a minute, so rotating across
 *   the /56s of one allocation gains little;
 * - per event, from everyone: {@link PER_EVENT_PER_MINUTE} a minute, so one
 *   event can't be inflated from many addresses faster than that.
 *
 * A source is an IPv4 address or an IPv6 /56 (`@/lib/client-address` gives
 * the visitor's address behind Cloudflare). Keys are truncated SHA-256s, in
 * memory only, never sent, logged or stored.
 *
 * Bounded and fail-closed: every table holds at most {@link MAX_ENTRIES}
 * entries and each call is O(1). When a table is full, only an entry whose
 * window has certainly ended (its last hit is older than the window) is
 * evicted; a live entry is never evicted, so eviction never hands anyone a
 * fresh allowance early. If no such entry exists the view is not recorded
 * (the page is unaffected). A single source holds at most 300 live pair
 * entries (30 a minute for 10 minutes), so filling the pair table takes
 * ~170 sources flooding at once, and then only recording pauses, until
 * their entries age out. The caps are per server instance: a loop guard,
 * not a global quota; the API's own rate limit is the global one.
 */

import { createHash } from "node:crypto";

export const PER_SOURCE_PER_EVENT = 5;
export const PER_SOURCE_PER_MINUTE = 30;
export const PER_NETWORK_PER_MINUTE = 300;
export const PER_EVENT_PER_MINUTE = 600;
export const MAX_ENTRIES = 50_000;
const MINUTE_MS = 60_000;
const PAIR_WINDOW_MS = 10 * MINUTE_MS;

interface Bucket {
  start: number;
  count: number;
  lastHit: number;
}

/** Fixed-window counters per key in a bounded map kept in last-hit order. */
class Limiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries: number = MAX_ENTRIES,
  ) {}

  get size(): number {
    return this.buckets.size;
  }

  /** Would one more be allowed? Never evicts a live entry; false when full of them. */
  check(key: string, now: number): boolean {
    const b = this.buckets.get(key);
    if (b) return now - b.start >= this.windowMs || b.count < this.limit;
    if (this.buckets.size < this.maxEntries) return true;
    // Full: drop the least recently hit entry only if its window is over.
    // Entries are in last-hit order, so if the oldest is live, all are.
    const oldest = this.buckets.entries().next().value;
    if (oldest && now - oldest[1].lastHit >= this.windowMs) {
      this.buckets.delete(oldest[0]);
      return true;
    }
    return false;
  }

  /** Count one (call only after every limiter's `check` passed). */
  hit(key: string, now: number): void {
    const b = this.buckets.get(key);
    this.buckets.delete(key); // re-insert: most recently hit last
    if (b && now - b.start < this.windowMs) {
      b.count += 1;
      b.lastHit = now;
      this.buckets.set(key, b);
    } else {
      this.buckets.set(key, { start: now, count: 1, lastHit: now });
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}

const perPair = new Limiter(PER_SOURCE_PER_EVENT, PAIR_WINDOW_MS);
const perSource = new Limiter(PER_SOURCE_PER_MINUTE, MINUTE_MS);
const perNetwork = new Limiter(PER_NETWORK_PER_MINUTE, MINUTE_MS);
const perEvent = new Limiter(PER_EVENT_PER_MINUTE, MINUTE_MS);

/** The eight hextets of an IPv6 address (`::` expanded), or null. */
function hextets(ip: string): string[] | null {
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const all = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (all.length !== 8) return null;
  return all.map((h) => h.replace(/^0+(?=.)/, "") || "0");
}

/** IPv4 as is; IPv6 cut to `bits` (48, 56 or 64). */
function prefix(address: string, bits: 48 | 56 | 64): string {
  const ip = address.trim().toLowerCase();
  if (!ip.includes(":")) return ip || "unknown";
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return v4mapped[1];
  const h = hextets(ip);
  if (!h) return ip;
  const whole = Math.floor(bits / 16);
  const kept = h.slice(0, whole);
  if (bits % 16) {
    const next = parseInt(h[whole], 16) & 0xff00;
    kept.push(next.toString(16));
  }
  return `${kept.join(":")}::/${bits}`;
}

/** A source: an IPv4 address or an IPv6 /56. */
export function sourceOf(address: string): string {
  return prefix(address, 56);
}

/** The network a source belongs to: the IPv4 address or an IPv6 /48. */
export function networkOf(address: string): string {
  return prefix(address, 48);
}

const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 32);

/** True when this view may be recorded; false over any cap, or when unsure. */
export function allowView(
  address: string,
  eventId: string,
  now: number = Date.now(),
): boolean {
  try {
    const ip = address.slice(0, 64);
    const source = hash(sourceOf(ip));
    const network = hash(networkOf(ip));
    const event = hash(eventId.slice(0, 64));
    const pair = `${source}:${event}`;
    if (
      !perSource.check(source, now) ||
      !perNetwork.check(network, now) ||
      !perEvent.check(event, now) ||
      !perPair.check(pair, now)
    )
      return false;
    perSource.hit(source, now);
    perNetwork.hit(network, now);
    perEvent.hit(event, now);
    perPair.hit(pair, now);
    return true;
  } catch {
    return false; // can't decide: don't record
  }
}

/** Test hook: how many entries the tables hold. */
export function __viewThrottleSize(): number {
  return perPair.size + perSource.size + perNetwork.size + perEvent.size;
}

/** Test hook: forget everything. */
export function __resetViewThrottle(): void {
  perPair.clear();
  perSource.clear();
  perNetwork.clear();
  perEvent.clear();
}

/** Test hook: a limiter with a small table, to exercise the full-table rule. */
export function __limiterForTest(limit: number, windowMs: number, max: number) {
  return new Limiter(limit, windowMs, max);
}
