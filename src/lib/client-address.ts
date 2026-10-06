import "server-only";

/**
 * The viewer's trusted address for view counting, or null when there is none
 * we can trust. No module state.
 *
 * events.mukoko.com is served through Cloudflare in front of Vercel, so the
 * peer Vercel sees (`x-vercel-forwarded-for` / `x-real-ip`, set by Vercel's
 * edge) is a Cloudflare edge shared by many visitors. Cloudflare passes the
 * visitor in `cf-connecting-ip`, but a peer in Cloudflare's ranges is not
 * proof the request came through OUR zone: a Worker on any Cloudflare account
 * can call the origin with a `cf-connecting-ip` of its choosing. So the
 * `cf-*` headers are trusted only when the request also carries our zone's
 * edge credential: the `x-mukoko-edge-auth` header, added by a Transform Rule
 * on the events.mukoko.com zone with the value of `EDGE_AUTH_SECRET`
 * (compared in constant time).
 *
 * - Cloudflare peer + valid edge credential + valid `cf-connecting-ip`: the
 *   visitor's address.
 * - Cloudflare peer without it: null (no view recorded): the edge's address
 *   would merge everyone behind it, and the `cf-*` values could be forged.
 * - Any other peer (a direct request to the origin): the peer itself.
 * - The caller-supplied first `x-forwarded-for` entry is never used, and no
 *   city is ever taken from these headers (the edge's city is not the
 *   viewer's).
 */

import { timingSafeEqual } from "node:crypto";

/** https://www.cloudflare.com/ips-v4 and /ips-v6 (fetched 2026-10-06). */
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

interface Parsed {
  v6: boolean;
  value: bigint;
}

function parseV4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    value = (value << BigInt(8)) | BigInt(n);
  }
  return value;
}

function parseV6(ip: string): bigint | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const all = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (all.length !== 8) return null;
  let value = BigInt(0);
  for (const h of all) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    value = (value << BigInt(16)) | BigInt(parseInt(h, 16));
  }
  return value;
}

/** A plain IPv4 or IPv6 address (IPv4-mapped IPv6 becomes IPv4), else null. */
export function parseIp(raw: string | null | undefined): Parsed | null {
  if (!raw) return null;
  const ip = raw.trim().toLowerCase();
  if (!ip || ip.length > 45) return null;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const v = parseV4(mapped[1]);
    return v === null ? null : { v6: false, value: v };
  }
  if (ip.includes(":")) {
    const v = parseV6(ip);
    return v === null ? null : { v6: true, value: v };
  }
  const v = parseV4(ip);
  return v === null ? null : { v6: false, value: v };
}

const ranges = CLOUDFLARE_RANGES.map((cidr) => {
  const [base, bits] = cidr.split("/");
  const parsed = parseIp(base)!;
  const width = parsed.v6 ? BigInt(128) : BigInt(32);
  const shift = width - BigInt(bits);
  return { v6: parsed.v6, shift, prefix: parsed.value >> shift };
});

export function isCloudflare(raw: string | null | undefined): boolean {
  const ip = parseIp(raw);
  if (!ip) return false;
  return ranges.some((r) => r.v6 === ip.v6 && ip.value >> r.shift === r.prefix);
}

type HeaderGetter = { get(name: string): string | null };

/** Does the request carry our Cloudflare zone's edge credential? */
export function hasEdgeCredential(
  h: HeaderGetter,
  secret: string | undefined = process.env.EDGE_AUTH_SECRET,
): boolean {
  const expected = secret?.trim();
  const given = h.get("x-mukoko-edge-auth")?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The visitor identity of an address: IPv4 as is, IPv6 cut to its /64 (one
 * host or home holds a whole /64 and privacy addresses rotate inside it, so
 * the full address would let one visitor count as many).
 */
export function visitorNetwork(raw: string): string | null {
  const ip = parseIp(raw);
  if (!ip) return null;
  if (!ip.v6) {
    const v = Number(ip.value);
    return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
  }
  const hextets: string[] = [];
  for (let i = 7; i >= 4; i--)
    hextets.push(((ip.value >> BigInt(16 * i)) & BigInt(0xffff)).toString(16));
  return `${hextets.join(":")}::/64`;
}

/** The viewer's address, or null when none can be trusted. */
export function trustedClientIp(
  h: HeaderGetter,
  secret: string | undefined = process.env.EDGE_AUTH_SECRET,
): string | null {
  const peer =
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "";
  if (!parseIp(peer)) return null;
  if (!isCloudflare(peer)) return peer;
  if (!hasEdgeCredential(h, secret)) return null;
  const visitor = h.get("cf-connecting-ip")?.trim() ?? "";
  return parseIp(visitor) ? visitor : null;
}
