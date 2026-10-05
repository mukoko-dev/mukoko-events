/**
 * Server-side circle access loader — the 404 decision and the batch link
 * check event pages use. The policy itself is in src/lib/circle-access.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const circles = { findOne: vi.fn(), find: vi.fn() };
const memberships = { findOne: vi.fn(), find: vi.fn() };
vi.mock("./databases", () => ({
  circlesCollection: vi.fn(async () => circles),
  circleMembershipsCollection: vi.fn(async () => memberships),
}));

import { loadCircleAccess, visibleCircleLinkIds } from "./circle-access";

const cursor = <T>(docs: T[]) => {
  const c = { project: () => c, toArray: async () => docs };
  return c;
};
const doc = (id: string, circleType: string, isActive = true) => ({
  _id: id,
  name: id,
  circleType,
  isActive,
});

beforeEach(() => {
  vi.clearAllMocks();
  memberships.findOne.mockResolvedValue(null);
  memberships.find.mockReturnValue(cursor([]));
});

describe("loadCircleAccess", () => {
  it("returns null (404) for a secret circle to anonymous and non-member viewers", async () => {
    circles.findOne.mockResolvedValue(doc("s", "secret"));
    expect(await loadCircleAccess("s", null)).toBeNull();
    expect(memberships.findOne).not.toHaveBeenCalled();
    expect(await loadCircleAccess("s", "p-outsider")).toBeNull();
  });

  it("resolves a member's access from their own membership row only", async () => {
    circles.findOne.mockResolvedValue(doc("s", "secret"));
    memberships.findOne.mockResolvedValue({
      role: "admin",
      membershipStatus: "active",
    });
    const r = await loadCircleAccess("s", "p-admin");
    expect(r?.permissions.access).toBe("staff");
    expect(memberships.findOne).toHaveBeenCalledWith({
      circleId: "s",
      memberPersonId: "p-admin",
    });
  });

  it("returns null for a missing id or circle", async () => {
    expect(await loadCircleAccess("", null)).toBeNull();
    circles.findOne.mockResolvedValue(null);
    expect(await loadCircleAccess("x", null)).toBeNull();
  });
});

describe("visibleCircleLinkIds (event pages)", () => {
  it("links public and broadcast circles for anyone, private and secret for members only", async () => {
    circles.find.mockReturnValue(
      cursor([
        doc("pub", "public"),
        doc("bc", "broadcast"),
        doc("priv", "private"),
        doc("sec", "secret"),
        doc("old", "public", false),
      ]),
    );
    const all = ["pub", "bc", "priv", "sec", "old"];
    expect([...(await visibleCircleLinkIds(all, null))].sort()).toEqual([
      "bc",
      "pub",
    ]);

    memberships.find.mockReturnValue(
      cursor([
        { circleId: "priv", role: "member", membershipStatus: "active" },
        { circleId: "sec", role: "member", membershipStatus: "invited" },
      ]),
    );
    expect([...(await visibleCircleLinkIds(all, "p-member"))].sort()).toEqual([
      "bc",
      "priv",
      "pub",
    ]);
  });

  it("fails closed when the lookup errors", async () => {
    circles.find.mockImplementation(() => {
      throw new Error("down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await visibleCircleLinkIds(["pub"], null)).size).toBe(0);
    warn.mockRestore();
  });
});
