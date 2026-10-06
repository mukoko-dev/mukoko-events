import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __limiterForTest,
  __resetViewThrottle,
  __viewThrottleSize,
  allowView,
  MAX_ENTRIES,
  networkOf,
  PER_EVENT_PER_MINUTE,
  PER_NETWORK_PER_MINUTE,
  PER_SOURCE_PER_EVENT,
  PER_SOURCE_PER_MINUTE,
  sourceOf,
} from "./view-throttle";

beforeEach(() => __resetViewThrottle());

const v4 = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

describe("sourceOf / networkOf", () => {
  it("keeps IPv4 and cuts IPv6 to a /56 source and a /48 network", () => {
    expect(sourceOf("203.0.113.7")).toBe("203.0.113.7");
    expect(sourceOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(sourceOf("2001:db8:1:2a3::1")).toBe("2001:db8:1:200::/56");
    expect(networkOf("2001:db8:1:2a3::1")).toBe("2001:db8:1::/48");
    expect(sourceOf("")).toBe("unknown");
  });
});

describe("allowView", () => {
  it("caps one source on one event, and across events", () => {
    for (let i = 0; i < PER_SOURCE_PER_EVENT; i++)
      expect(allowView("203.0.113.7", "evt-1", i)).toBe(true);
    expect(allowView("203.0.113.7", "evt-1", 100)).toBe(false);
    for (let i = PER_SOURCE_PER_EVENT; i < PER_SOURCE_PER_MINUTE; i++)
      expect(allowView("203.0.113.7", `evt-${i}`, 200)).toBe(true);
    expect(allowView("203.0.113.7", "evt-other", 300)).toBe(false);
  });

  it("caps one event flooded from many addresses (per subject)", () => {
    let allowed = 0;
    for (let i = 0; i < PER_EVENT_PER_MINUTE * 3; i++)
      if (allowView(v4(i), "evt-hot", 0)) allowed += 1;
    expect(allowed).toBe(PER_EVENT_PER_MINUTE);
    expect(allowView(v4(999_999), "evt-hot", 60_001)).toBe(true);
  });

  it("caps a whole IPv6 /48 rotating /56s", () => {
    let allowed = 0;
    for (let s = 0; s < 64; s++)
      for (let i = 0; i < PER_SOURCE_PER_MINUTE; i++)
        if (
          allowView(`2001:db8:1:${(s + 1).toString(16)}00::1`, `e${s}-${i}`, 0)
        )
          allowed += 1;
    expect(allowed).toBe(PER_NETWORK_PER_MINUTE);
  });

  it("stays bounded, and quick, under a flood of distinct keys", () => {
    const started = performance.now();
    for (let i = 0; i < 120_000; i++) allowView(v4(i), `e${i}`, 0);
    expect(__viewThrottleSize()).toBeLessThanOrEqual(4 * MAX_ENTRIES);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe("a full table fails closed", () => {
  it("never evicts a live entry, so no early fresh allowance", () => {
    const limiter = __limiterForTest(2, 60_000, 3);
    for (const k of ["a", "b", "c"]) {
      expect(limiter.check(k, 0)).toBe(true);
      limiter.hit(k, 0);
    }
    // Full of live entries: a newcomer is refused, not let through.
    expect(limiter.check("d", 10)).toBe(false);
    expect(limiter.size).toBe(3);
    // "a" stays capped: it was not evicted to make room.
    limiter.hit("a", 20);
    expect(limiter.check("a", 30)).toBe(false);
    // Once the least recently hit entry's window is over, it makes room.
    expect(limiter.check("d", 60_001)).toBe(true);
    limiter.hit("d", 60_001);
    expect(limiter.size).toBe(3);
  });

  it("refuses views when the shared tables are full of live entries", () => {
    // Fill the per-source table to its bound with live entries.
    for (let i = 0; i < MAX_ENTRIES; i++) allowView(v4(i), `e${i}`, 0);
    expect(allowView("192.0.2.200", "evt-new", 1)).toBe(false);
    // After the window, room again.
    expect(allowView("192.0.2.200", "evt-new", 10 * 60_000 + 1)).toBe(true);
  });
});
