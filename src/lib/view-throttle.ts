import "server-only";

/**
 * Abuse caps for recording page views (`trackEventViewAction`).
 *
 * The action is public and posts with Mukoko Events' own service token,
 * whose API rate limit is far higher than an anonymous caller's. So that
 * this action is never a better door than calling the API directly, each
 * source gets the API's own anonymous allowance: {@link PER_SOURCE_PER_MINUTE}
 * views a minute, and an IPv6 /48 at most {@link PER_NETWORK_PER_MINUTE}.
 * Repeat views from a real browser are de-duplicated in the browser
 * (`EventViewTracker`); the API answers 404 for an unknown event.
 *
 * Memory and work are bounded whatever callers send: two LRU tables of at
 * most {@link MAX_ENTRIES} entries each, O(1) per call, with the oldest entry
 * evicted (an attacker's own entries are the newest, so eviction never
 * frees their quota). A source is an IPv4 address or an IPv6 /56; keys are
 * SHA-256s, in memory only, never sent, logged or stored.
 */

import { createHash } from "node:crypto";

export const PER_SOURCE_PER_MINUTE = 30;
export const PER_NETWORK_PER_MINUTE = 300;
export const MAX_ENTRIES = 10_000;
const MINUTE_MS = 60_000;

interface Bucket {
  start: number;
  count: number;
}

/** A fixed-window counter per key, in a bounded LRU map. */
class Limiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly limit: number) {}

  get size(): number {
    return this.buckets.size;
  }

  /** Would one more be allowed? Does not count it. */
  check(key: string, now: number): boolean {
    const b = this.buckets.get(key);
    return !b || now - b.start >= MINUTE_MS || b.count < this.limit;
  }

  /** Count one (call only after every limiter's `check` passed). */
  hit(key: string, now: number): void {
    const b = this.buckets.get(key);
    this.buckets.delete(key); // re-insert: most recently used last
    if (b && now - b.start < MINUTE_MS) {
      b.count += 1;
      this.buckets.set(key, b);
    } else {
      this.buckets.set(key, { start: now, count: 1 });
    }
    if (this.buckets.size > MAX_ENTRIES) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}

const perSource = new Limiter(PER_SOURCE_PER_MINUTE);
const perNetwork = new Limiter(PER_NETWORK_PER_MINUTE);

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

/** True when this view may be recorded; false over either cap. */
export function allowView(address: string, now: number = Date.now()): boolean {
  const source = hash(sourceOf(address.slice(0, 64)));
  const network = hash(networkOf(address.slice(0, 64)));
  if (!perSource.check(source, now) || !perNetwork.check(network, now))
    return false;
  perSource.hit(source, now);
  perNetwork.hit(network, now);
  return true;
}

/** Test hook: how many entries the tables hold. */
export function __viewThrottleSize(): number {
  return perSource.size + perNetwork.size;
}

/** Test hook: forget everything. */
export function __resetViewThrottle(): void {
  perSource.clear();
  perNetwork.clear();
}
