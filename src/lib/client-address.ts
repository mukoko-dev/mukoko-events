import "server-only";

/**
 * The viewer's address and city for view counting, as trustworthy as the
 * deployment allows.
 *
 * events.mukoko.com is served through Cloudflare in front of Vercel, so the
 * peer Vercel sees (`x-real-ip`, and its `x-vercel-ip-city`) is a Cloudflare
 * edge, shared by every visitor routed through it. Cloudflare passes the
 * visitor's address in `cf-connecting-ip` (and, with visitor location
 * headers on, the city in `cf-ipcity`). Those headers are trusted ONLY when
 * the peer is inside Cloudflare's published ranges: a request sent straight
 * to the Vercel origin can carry a forged `cf-connecting-ip`, and then the
 * peer is not Cloudflare, so the peer itself is used.
 *
 * `x-real-ip` and the last `x-forwarded-for` entry are set by Vercel's edge
 * (it overwrites caller-supplied values); the caller-supplied first
 * `x-forwarded-for` entry is never used.
 */

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

function decodeCity(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const city = decodeURIComponent(raw).trim().slice(0, 100);
    return city || undefined;
  } catch {
    return undefined;
  }
}

/** The viewer's address ("" when unknown) and city, from trusted headers only. */
export function clientAddress(h: HeaderGetter): {
  address: string;
  city?: string;
} {
  const peer =
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "";
  if (isCloudflare(peer)) {
    const visitor = h.get("cf-connecting-ip")?.trim() ?? "";
    // Behind Cloudflare, Vercel's city is the edge's; only Cloudflare's own
    // visitor city is the viewer's.
    if (parseIp(visitor))
      return { address: visitor, city: decodeCity(h.get("cf-ipcity")) };
    return { address: peer };
  }
  return {
    address: parseIp(peer) ? peer : "",
    city: decodeCity(h.get("x-vercel-ip-city")),
  };
}
