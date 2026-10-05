import { describe, it, expect, vi, beforeEach } from "vitest";

// Guard imports (`server-only`) and the Mongo driver layer so the circles
// read module can be unit-tested with a fake collection (no cluster here).
vi.mock("server-only", () => ({}));

const circles = { find: vi.fn(), findOne: vi.fn() };
const memberships = { findOne: vi.fn() };

/** Minimal chainable cursor stub resolving to `docs`. */
function cursor<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    project: vi.fn(() => c),
    toArray: vi.fn(async () => docs),
  };
  return c;
}

vi.mock("@/lib/mongo/databases", () => ({
  circlesCollection: vi.fn(async () => circles),
  circleMembershipsCollection: vi.fn(async () => memberships),
}));

import { getCircleSummary, listFeaturedCircles } from "./circles";

function circleDoc(id: string, circleType: unknown) {
  return {
    _id: id,
    name: `Circle ${id}`,
    description: null,
    circleType,
    isActive: true,
    memberCount: 3,
    postCount: 1,
  };
}

describe("listFeaturedCircles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks Mongo for active public and broadcast circles only", async () => {
    circles.find.mockReturnValue(cursor([]));
    await listFeaturedCircles(6);
    expect(circles.find).toHaveBeenCalledWith({
      isActive: true,
      circleType: { $in: ["public", "broadcast"] },
    });
    const filter = circles.find.mock.calls[0][0];
    expect(filter.circleType.$in).not.toContain("private");
    expect(filter.circleType.$in).not.toContain("secret");
  });

  it("drops private, secret and untyped circles even if the query returns them", async () => {
    circles.find.mockReturnValue(
      cursor([
        circleDoc("pub", "public"),
        circleDoc("priv", "private"),
        circleDoc("sec", "secret"),
        circleDoc("none", undefined),
        circleDoc("odd", "invite-only"),
        circleDoc("bc", "broadcast"),
      ]),
    );
    const out = await listFeaturedCircles(6);
    expect(out.map((c) => [c.id, c.circleType])).toEqual([
      ["pub", "public"],
      ["bc", "broadcast"],
    ]);
  });
});

describe("getCircleSummary (calendar provenance link)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberships.findOne.mockResolvedValue(null);
  });

  it("names public and broadcast circles to anyone", async () => {
    for (const type of ["public", "broadcast"]) {
      circles.findOne.mockResolvedValueOnce(circleDoc("c1", type));
      expect(await getCircleSummary("c1", null)).toEqual({
        id: "c1",
        name: "Circle c1",
      });
    }
  });

  it("never names a private or secret circle to an anonymous or non-member viewer", async () => {
    for (const type of ["private", "secret", undefined]) {
      for (const viewer of [null, "p-outsider"]) {
        circles.findOne.mockResolvedValueOnce(circleDoc("c1", type));
        expect(await getCircleSummary("c1", viewer)).toBeNull();
      }
    }
  });

  it("names a private or secret circle to its active members", async () => {
    memberships.findOne.mockResolvedValue({
      role: "member",
      membershipStatus: "active",
    });
    for (const type of ["private", "secret"]) {
      circles.findOne.mockResolvedValueOnce(circleDoc("c1", type));
      expect(await getCircleSummary("c1", "p-member")).toEqual({
        id: "c1",
        name: "Circle c1",
      });
    }
    expect(memberships.findOne).toHaveBeenCalledWith({
      circleId: "c1",
      memberPersonId: "p-member",
    });
  });

  it("does not name an inactive or missing circle", async () => {
    circles.findOne.mockResolvedValueOnce({
      ...circleDoc("c1", "public"),
      isActive: false,
    });
    expect(await getCircleSummary("c1", null)).toBeNull();
    circles.findOne.mockResolvedValueOnce(null);
    expect(await getCircleSummary("c1", null)).toBeNull();
  });
});
