import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  hasEdgeCredential,
  isCloudflare,
  parseIp,
  trustedClientIp,
} from "./client-address";

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});
const SECRET = "edge-test-credential";

describe("isCloudflare (static, published ranges)", () => {
  it.each([
    ["173.245.48.1", true],
    ["172.70.1.2", true],
    ["104.16.0.1", true],
    ["131.0.75.255", true],
    ["2606:4700:10::ac43:1", true],
    ["2a06:98c7:ffff::1", true],
    ["203.0.113.7", false],
    ["104.32.0.1", false],
    ["2001:db8::1", false],
    ["not-an-ip", false],
  ])("%s → %s", (ip, expected) => {
    expect(isCloudflare(ip)).toBe(expected);
  });

  it("parses IPv4-mapped IPv6 as IPv4", () => {
    expect(parseIp("::ffff:172.70.1.2")?.v6).toBe(false);
  });
});

describe("trustedClientIp", () => {
  it("behind our Cloudflare zone (edge credential), uses the visitor", () => {
    expect(
      trustedClientIp(
        headers({
          "x-vercel-forwarded-for": "172.70.1.2",
          "x-mukoko-edge-auth": SECRET,
          "cf-connecting-ip": "203.0.113.7",
        }),
        SECRET,
      ),
    ).toBe("203.0.113.7");
  });

  it("refuses a Cloudflare peer without our edge credential (any Worker can forge cf-connecting-ip)", () => {
    const h = {
      "x-vercel-forwarded-for": "172.70.1.2",
      "cf-connecting-ip": "203.0.113.7",
    };
    expect(trustedClientIp(headers(h), SECRET)).toBeNull();
    expect(
      trustedClientIp(headers({ ...h, "x-mukoko-edge-auth": "wrong" }), SECRET),
    ).toBeNull();
    // No secret configured: nothing behind Cloudflare is trusted.
    expect(
      trustedClientIp(headers({ ...h, "x-mukoko-edge-auth": SECRET }), ""),
    ).toBeNull();
  });

  it("ignores spoofed cf-connecting-ip and x-forwarded-for from a non-Cloudflare peer", () => {
    expect(
      trustedClientIp(
        headers({
          "x-real-ip": "198.51.100.9",
          "x-forwarded-for": "1.2.3.4, 198.51.100.9",
          "cf-connecting-ip": "203.0.113.7",
          "x-mukoko-edge-auth": SECRET,
        }),
        SECRET,
      ),
    ).toBe("198.51.100.9");
  });

  it("is null with no trusted peer", () => {
    expect(
      trustedClientIp(headers({ "x-forwarded-for": "1.2.3.4" }), SECRET),
    ).toBeNull();
    expect(trustedClientIp(headers({}), SECRET)).toBeNull();
  });

  it("compares the edge credential exactly", () => {
    expect(
      hasEdgeCredential(headers({ "x-mukoko-edge-auth": SECRET }), SECRET),
    ).toBe(true);
    expect(
      hasEdgeCredential(
        headers({ "x-mukoko-edge-auth": `${SECRET}x` }),
        SECRET,
      ),
    ).toBe(false);
  });
});
