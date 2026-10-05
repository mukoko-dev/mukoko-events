/**
 * The circle access policy, per audience and circle type — the rules in
 * nyuchi/api-gateway docs/architecture/circles.md.
 */
import { describe, it, expect } from "vitest";
import {
  circlePermissions,
  canReadPostVisibility,
  defaultPostVisibility,
  normaliseCircleType,
  resolveCircleAccess,
  type CircleAccessMembership,
} from "./circle-access";

const circle = (circleType: unknown, isActive = true) => ({
  circleType,
  isActive,
});
const anonymous = null;
const nonMember = null; // a signed-in person with no membership row
const member: CircleAccessMembership = {
  role: "member",
  membershipStatus: "active",
};
const staff: CircleAccessMembership = {
  role: "moderator",
  membershipStatus: "active",
};
const owner: CircleAccessMembership = {
  role: "owner",
  membershipStatus: "active",
};
const as = (membershipStatus: string): CircleAccessMembership => ({
  role: "member",
  membershipStatus,
});

describe("resolveCircleAccess", () => {
  it.each([
    ["public", anonymous, "reader"],
    ["public", nonMember, "reader"],
    ["public", member, "member"],
    ["public", staff, "staff"],
    ["broadcast", anonymous, "reader"],
    ["broadcast", member, "member"],
    ["broadcast", owner, "staff"],
    ["private", anonymous, "preview"],
    ["private", nonMember, "preview"],
    ["private", member, "member"],
    ["private", staff, "staff"],
    ["secret", anonymous, "hidden"],
    ["secret", nonMember, "hidden"],
    ["secret", member, "member"],
    ["secret", staff, "staff"],
  ] as const)("%s circle, %o → %s", (type, membership, expected) => {
    expect(resolveCircleAccess(circle(type), membership)).toBe(expected);
  });

  it("shows a secret circle's preview to an invitee only", () => {
    expect(resolveCircleAccess(circle("secret"), as("invited"))).toBe(
      "preview",
    );
    expect(resolveCircleAccess(circle("secret"), as("pending_approval"))).toBe(
      "hidden",
    );
    expect(resolveCircleAccess(circle("secret"), as("left"))).toBe("hidden");
    expect(resolveCircleAccess(circle("secret"), as("banned"))).toBe("hidden");
  });

  it("treats a non-active membership as no membership", () => {
    for (const status of ["pending_approval", "left", "removed", "banned"]) {
      expect(resolveCircleAccess(circle("private"), as(status))).toBe(
        "preview",
      );
      expect(resolveCircleAccess(circle("public"), as(status))).toBe("reader");
    }
  });

  it("hides an inactive or missing circle from everyone, members included", () => {
    expect(resolveCircleAccess(circle("public", false), owner)).toBe("hidden");
    expect(resolveCircleAccess(null, member)).toBe("hidden");
  });

  it("fails closed: a missing or unknown type is treated as secret", () => {
    expect(normaliseCircleType(undefined)).toBe("secret");
    expect(normaliseCircleType("Public")).toBe("secret");
    expect(resolveCircleAccess(circle(null), anonymous)).toBe("hidden");
    expect(resolveCircleAccess(circle("open"), nonMember)).toBe("hidden");
    expect(resolveCircleAccess(circle("open"), member)).toBe("member");
  });
});

describe("circlePermissions", () => {
  it("anonymous on a public circle: public posts, events; no roster, no writes", () => {
    const p = circlePermissions(circle("public"), anonymous);
    expect(p).toMatchObject({
      canSeeCircle: true,
      canReadPosts: true,
      readablePostVisibilities: ["public"],
      canSeeEvents: true,
      canSeeMembers: false,
      canPost: false,
      canReact: false,
      canUseChat: false,
      canSeeArchive: false,
      canBeLinked: true,
      join: "join",
    });
  });

  it("non-member on a private circle: preview only, request to join", () => {
    const p = circlePermissions(circle("private"), nonMember);
    expect(p).toMatchObject({
      access: "preview",
      canSeeCircle: true,
      canReadPosts: false,
      readablePostVisibilities: [],
      canSeeEvents: false,
      canSeeMembers: false,
      canPost: false,
      canReact: false,
      canUseChat: false,
      canBeLinked: false,
      join: "request",
    });
    expect(
      circlePermissions(circle("private"), as("pending_approval")).join,
    ).toBe("requested");
  });

  it("non-member on a secret circle: nothing at all", () => {
    const p = circlePermissions(circle("secret"), nonMember);
    expect(p.canSeeCircle).toBe(false);
    expect(p.canReadPosts || p.canSeeEvents || p.canPost).toBe(false);
    expect(p.join).toBeNull();
    expect(circlePermissions(circle("secret"), as("invited")).join).toBe(
      "accept_invite",
    );
  });

  it("member: reads members' posts, posts, reacts, chats, sees the roster", () => {
    for (const type of ["public", "private", "secret"]) {
      const p = circlePermissions(circle(type), member);
      expect(p).toMatchObject({
        canReadPosts: true,
        readablePostVisibilities: ["public", "circle_members"],
        canSeeEvents: true,
        canSeeMembers: true,
        canPost: true,
        canReact: true,
        canUseChat: true,
        canSeeArchive: false,
        canBeLinked: true,
        join: null,
      });
    }
  });

  it("broadcast: only staff post; members still react and read", () => {
    expect(circlePermissions(circle("broadcast"), member).canPost).toBe(false);
    expect(circlePermissions(circle("broadcast"), member).canReact).toBe(true);
    expect(circlePermissions(circle("broadcast"), staff).canPost).toBe(true);
    expect(circlePermissions(circle("broadcast"), anonymous).join).toBe(
      "follow",
    );
  });

  it("staff: also admin-only posts and the removed-post archive", () => {
    const p = circlePermissions(circle("private"), staff);
    expect(p.readablePostVisibilities).toEqual([
      "public",
      "circle_members",
      "circle_admins_only",
    ]);
    expect(p.canSeeArchive).toBe(true);
  });

  it("a banned person gets no join affordance", () => {
    expect(circlePermissions(circle("public"), as("banned")).join).toBeNull();
    expect(circlePermissions(circle("private"), as("banned")).join).toBeNull();
  });
});

describe("post visibility", () => {
  it("defaults to public only in public and broadcast circles", () => {
    expect(defaultPostVisibility("public")).toBe("public");
    expect(defaultPostVisibility("broadcast")).toBe("public");
    expect(defaultPostVisibility("private")).toBe("circle_members");
    expect(defaultPostVisibility("secret")).toBe("circle_members");
    expect(defaultPostVisibility(undefined)).toBe("circle_members");
  });

  it("checks one post against the viewer's readable visibilities", () => {
    const reader = circlePermissions(circle("public"), anonymous);
    expect(canReadPostVisibility(reader, "public")).toBe(true);
    expect(canReadPostVisibility(reader, "circle_members")).toBe(false);
    expect(canReadPostVisibility(reader, undefined)).toBe(false);
  });
});
