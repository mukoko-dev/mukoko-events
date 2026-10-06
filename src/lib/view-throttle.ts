import "server-only";

/**
 * Abuse caps for recording page views (`trackEventViewAction`).
 *
 * The action is public and posts with Mukoko Events' own service token, so a
 * loop could inflate one event's views or burn the key's rate limit that other
 * reads share. Repeat views from one real browser are de-duplicated in the
 * browser (`EventViewTracker`); these are server-side ceilings, set above what
 * a crowd behind one carrier address (CGNAT) produces:
 *
 * - per source and event: {@link PER_SOURCE_PER_EVENT} views per 30 minutes;
 * - per source: {@link PER_SOURCE_PER_MINUTE} views a minute;
 * - per IPv6 /48: {@link PER_NETWORK_PER_MINUTE} views a minute, so rotating
 *   across the /64s or /56s of one allocation gains little.
 *
 * A source is an IPv4 address or an IPv6 /56 (a usual home allocation). Per
 * server instance, in memory: keys are SHA-256s, never sent, logged or stored.
 * When the tables are full of live entries, new sources are refused rather
 * than evicting live counts (a view is never worth an open door).
 */

import { createHash } from "node:crypto";

export const PER_SOURCE_PER_EVENT = 10;
export const PER_SOURCE_PER_MINUTE = 120;
export const PER_NETWORK_PER_MINUTE = 600;
const EVENT_WINDOW_MS = 30 * 60_000;
const MINUTE_MS = 60_000;
const MAX_ENTRIES = 20_000;

interface Bucket {
  start: number;
  count: number;
}

class Limiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Would one more be allowed? Does not count it. */
  check(key: string, now: number): boolean {
    const b = this.buckets.get(key);
    if (b && now - b.start < this.windowMs) return b.count < this.limit;
    if (b) return true;
    if (this.buckets.size < MAX_ENTRIES) return true;
    this.prune(now);
    return this.buckets.size < MAX_ENTRIES;
  }

  /** Count one (call only after every limiter's `check` passed). */
  hit(key: string, now: number): void {
    const b = this.buckets.get(key);
    if (b && now - b.start < this.windowMs) {
      b.count += 1;
      return;
    }
    this.buckets.set(key, { start: now, count: 1 });
  }

  private prune(now: number): void {
    for (const [key, b] of this.buckets)
      if (now - b.start >= this.windowMs) this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}

const perEvent = new Limiter(PER_SOURCE_PER_EVENT, EVENT_WINDOW_MS);
const perSource = new Limiter(PER_SOURCE_PER_MINUTE, MINUTE_MS);
const perNetwork = new Limiter(PER_NETWORK_PER_MINUTE, MINUTE_MS);

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

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** True when this view may be recorded; false over any cap. */
export function allowView(
  address: string,
  eventId: string,
  now: number = Date.now(),
): boolean {
  const source = hash(sourceOf(address));
  const network = hash(networkOf(address));
  const eventKey = `${source}:${eventId}`;
  if (
    !perEvent.check(eventKey, now) ||
    !perSource.check(source, now) ||
    !perNetwork.check(network, now)
  )
    return false;
  perEvent.hit(eventKey, now);
  perSource.hit(source, now);
  perNetwork.hit(network, now);
  return true;
}

/** Test hook: forget everything. */
export function __resetViewThrottle(): void {
  perEvent.clear();
  perSource.clear();
  perNetwork.clear();
}
