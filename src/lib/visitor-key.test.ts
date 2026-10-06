import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { uaFamily, visitorKey } from "./visitor-key";

const secret = "visitor-test-secret";
const day = new Date("2026-10-06T08:00:00Z");
const chrome =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";

describe("visitorKey", () => {
  it("is the same for one visitor all day, so repeats count once", () => {
    const a = visitorKey(
      { kind: "anonymous", ip: "203.0.113.7", userAgent: chrome },
      { secret, now: day },
    );
    const b = visitorKey(
      { kind: "anonymous", ip: "203.0.113.7", userAgent: chrome },
      { secret, now: new Date("2026-10-06T23:59:59Z") },
    );
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toBe(a);
  });

  it("rotates daily and differs between visitors and between people", () => {
    const base = {
      kind: "anonymous" as const,
      ip: "203.0.113.7",
      userAgent: chrome,
    };
    const today = visitorKey(base, { secret, now: day });
    expect(
      visitorKey(base, { secret, now: new Date("2026-10-07T00:00:00Z") }),
    ).not.toBe(today);
    expect(
      visitorKey({ ...base, ip: "198.51.100.9" }, { secret, now: day }),
    ).not.toBe(today);
    expect(
      visitorKey({ kind: "person", personId: "user_1" }, { secret, now: day }),
    ).not.toBe(
      visitorKey({ kind: "person", personId: "user_2" }, { secret, now: day }),
    );
  });

  it("never contains its inputs", () => {
    const key = visitorKey(
      { kind: "anonymous", ip: "203.0.113.7", userAgent: chrome },
      { secret, now: day },
    )!;
    expect(key).not.toContain("203");
  });

  it("is null without a secret or an identity", () => {
    expect(
      visitorKey(
        { kind: "anonymous", ip: "203.0.113.7" },
        { secret: "", now: day },
      ),
    ).toBeNull();
    expect(
      visitorKey({ kind: "anonymous", ip: "" }, { secret, now: day }),
    ).toBeNull();
    expect(
      visitorKey({ kind: "person", personId: "" }, { secret, now: day }),
    ).toBeNull();
  });

  it("reduces the user agent to a coarse family", () => {
    expect(uaFamily(chrome)).toBe("chrome-m");
    expect(uaFamily("Mozilla/5.0 (X11) Gecko/20100101 Firefox/131.0")).toBe(
      "firefox-d",
    );
    expect(uaFamily(null)).toBe("other-d");
  });
});
