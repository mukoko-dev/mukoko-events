import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __resetViewThrottle,
  allowView,
  PER_SOURCE_PER_MINUTE,
  sourceOf,
} from "./view-throttle";

beforeEach(() => __resetViewThrottle());

describe("sourceOf", () => {
  it("keeps IPv4 and cuts IPv6 to its /64", () => {
    expect(sourceOf("203.0.113.7")).toBe("203.0.113.7");
    expect(sourceOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(sourceOf("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(sourceOf("2001:0db8:0001:0002:ffff:1:2:3")).toBe(
      "2001:db8:1:2::/64",
    );
    expect(sourceOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(sourceOf("")).toBe("unknown");
  });
});

describe("allowView", () => {
  it("lets a crowd behind one address through, up to a generous cap a minute", () => {
    for (let i = 0; i < PER_SOURCE_PER_MINUTE; i++)
      expect(allowView("203.0.113.7", 0)).toBe(true);
    expect(allowView("203.0.113.7", 10)).toBe(false);
    expect(allowView("198.51.100.2", 10)).toBe(true);
    expect(allowView("203.0.113.7", 60_001)).toBe(true);
  });

  it("treats every address in one IPv6 /64 as one source", () => {
    for (let i = 0; i < PER_SOURCE_PER_MINUTE; i++)
      expect(allowView(`2001:db8:1:2::${(i + 1).toString(16)}`, 0)).toBe(true);
    expect(allowView("2001:db8:1:2:dead:beef::1", 10)).toBe(false);
  });
});
