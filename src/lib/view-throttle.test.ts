import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __resetViewThrottle,
  allowView,
  PER_VISITOR_PER_MINUTE,
  SAME_VIEW_MS,
} from "./view-throttle";

beforeEach(() => __resetViewThrottle());

describe("allowView", () => {
  it("counts one view per visitor per event per window", () => {
    expect(allowView("203.0.113.7", "evt-1", 0)).toBe(true);
    expect(allowView("203.0.113.7", "evt-1", 1000)).toBe(false);
    expect(allowView("198.51.100.2", "evt-1", 1000)).toBe(true);
    expect(allowView("203.0.113.7", "evt-1", SAME_VIEW_MS + 1)).toBe(true);
  });

  it("caps one visitor's views a minute across events", () => {
    for (let i = 0; i < PER_VISITOR_PER_MINUTE; i++)
      expect(allowView("203.0.113.7", `evt-${i}`, 0)).toBe(true);
    expect(allowView("203.0.113.7", "evt-extra", 10)).toBe(false);
    expect(allowView("203.0.113.7", "evt-extra", 60_001)).toBe(true);
  });
});
