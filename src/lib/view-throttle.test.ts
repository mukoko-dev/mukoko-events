import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __resetViewThrottle,
  allowView,
  networkOf,
  PER_NETWORK_PER_MINUTE,
  PER_SOURCE_PER_EVENT,
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
  it("caps one source's views of one event, but lets a crowd through", () => {
    for (let i = 0; i < PER_SOURCE_PER_EVENT; i++)
      expect(allowView("203.0.113.7", "evt-1", i)).toBe(true);
    expect(allowView("203.0.113.7", "evt-1", 100)).toBe(false);
    expect(allowView("203.0.113.7", "evt-2", 100)).toBe(true);
    expect(allowView("198.51.100.2", "evt-1", 100)).toBe(true);
    expect(allowView("203.0.113.7", "evt-1", 30 * 60_000 + 1)).toBe(true);
  });

  it("caps one source's views a minute across events", () => {
    for (let i = 0; i < PER_SOURCE_PER_MINUTE; i++)
      expect(allowView("203.0.113.7", `evt-${i}`, 0)).toBe(true);
    expect(allowView("203.0.113.7", "evt-extra", 10)).toBe(false);
    expect(allowView("203.0.113.7", "evt-extra", 60_001)).toBe(true);
  });

  it("treats a /56 as one source and caps a whole /48", () => {
    for (let i = 0; i < PER_SOURCE_PER_MINUTE; i++)
      expect(
        allowView(`2001:db8:1:200::${(i + 1).toString(16)}`, `e${i}`, 0),
      ).toBe(true);
    expect(allowView("2001:db8:1:2ff::1", "e-x", 1)).toBe(false);
    // Rotating /56s inside one /48 hits the network cap.
    let allowed = 0;
    for (let s = 0; s < 64; s++)
      for (let i = 0; i < PER_SOURCE_PER_MINUTE; i++)
        if (
          allowView(`2001:db8:1:${(s + 3).toString(16)}00::1`, `e${s}-${i}`, 2)
        )
          allowed += 1;
    expect(allowed).toBe(PER_NETWORK_PER_MINUTE - PER_SOURCE_PER_MINUTE);
  });
});
