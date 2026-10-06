import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __resetViewThrottle,
  __viewThrottleSize,
  allowView,
  MAX_ENTRIES,
  networkOf,
  PER_NETWORK_PER_MINUTE,
  PER_SOURCE_PER_MINUTE,
  sourceOf,
} from "./view-throttle";

beforeEach(() => __resetViewThrottle());

describe("sourceOf / networkOf", () => {
  it("keeps IPv4 and cuts IPv6 to a /56 source and a /48 network", () => {
    expect(sourceOf("203.0.113.7")).toBe("203.0.113.7");
    expect(sourceOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(sourceOf("2001:db8:1:2a3::1")).toBe("2001:db8:1:200::/56");
    expect(sourceOf("2001:0db8:0001:02ff:ffff:1:2:3")).toBe(
      "2001:db8:1:200::/56",
    );
    expect(networkOf("2001:db8:1:2a3::1")).toBe("2001:db8:1::/48");
    expect(sourceOf("2001:db8::1")).toBe("2001:db8:0:0::/56");
    expect(sourceOf("")).toBe("unknown");
  });
});

describe("allowView", () => {
  it("gives a source the API's anonymous allowance a minute", () => {
    for (let i = 0; i < PER_SOURCE_PER_MINUTE; i++)
      expect(allowView("203.0.113.7", 0)).toBe(true);
    expect(allowView("203.0.113.7", 10)).toBe(false);
    expect(allowView("198.51.100.2", 10)).toBe(true);
    expect(allowView("203.0.113.7", 60_001)).toBe(true);
  });

  it("treats a /56 as one source and caps a whole /48", () => {
    let allowed = 0;
    for (let s = 0; s < 64; s++)
      for (let i = 0; i < PER_SOURCE_PER_MINUTE; i++)
        if (allowView(`2001:db8:1:${(s + 1).toString(16)}00::${i + 1}`, 0))
          allowed += 1;
    expect(allowed).toBe(PER_NETWORK_PER_MINUTE);
  });

  it("stays bounded, and O(1), under a flood of distinct keys", () => {
    const started = performance.now();
    for (let i = 0; i < 50_000; i++)
      allowView(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, 0);
    for (let i = 0; i < 50_000; i++)
      allowView(`2001:db8:${i.toString(16)}::1`, 0);
    expect(__viewThrottleSize()).toBeLessThanOrEqual(2 * MAX_ENTRIES);
    expect(performance.now() - started).toBeLessThan(5_000);
    // A newcomer is still served once the tables are full.
    expect(allowView("192.0.2.1", 0)).toBe(true);
  });
});
