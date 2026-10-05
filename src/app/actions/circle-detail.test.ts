/**
 * Circle detail server actions — access per audience (anonymous, non-member,
 * member, circle staff) on each circle type. The real access policy and the
 * real server-side loader (`@/lib/mongo/circle-access`) run against small
 * in-memory collections; only the driver handles and the session are faked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Doc = Record<string, unknown> & { _id: string };

/** Equality, `$in` and `$ne` — all these actions use. */
function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ("$in" in c) return (c.$in as unknown[]).includes(value);
      if ("$ne" in c)
        return Array.isArray(value) ? !value.includes(c.$ne) : value !== c.$ne;
    }
    return Array.isArray(value) ? value.includes(cond) : value === cond;
  });
}

function fakeCollection(seed: Doc[] = []) {
  const docs: Doc[] = [...seed];
  const col = {
    docs,
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      return docs.find((d) => matches(d, filter)) ?? null;
    }),
    find: vi.fn((filter: Record<string, unknown>) => {
      let limit = Infinity;
      const cursor = {
        sort: () => cursor,
        project: () => cursor,
        limit: (n: number) => {
          limit = n;
          return cursor;
        },
        toArray: async () =>
          docs.filter((d) => matches(d, filter)).slice(0, limit),
      };
      return cursor;
    }),
    insertOne: vi.fn(async (doc: Doc) => {
      docs.push(doc);
      return { acknowledged: true };
    }),
    updateOne: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: Record<string, Record<string, unknown>>,
      ) => {
        const doc = docs.find((d) => matches(d, filter));
        if (!doc) return { modifiedCount: 0 };
        Object.assign(doc, update.$set ?? {});
        for (const [k, v] of Object.entries(update.$inc ?? {}))
          doc[k] = ((doc[k] as number) ?? 0) + (v as number);
        return { modifiedCount: 1 };
      },
    ),
  };
  return col;
}

let circles = fakeCollection();
let memberships = fakeCollection();
let posts = fakeCollection();
let persons = fakeCollection();

vi.mock("@/lib/mongo/databases", () => ({
  circlesCollection: vi.fn(async () => circles),
  circleMembershipsCollection: vi.fn(async () => memberships),
  circlePostsCollection: vi.fn(async () => posts),
  personsCollection: vi.fn(async () => persons),
}));

// The session: who is looking (reads) and who is acting (writes).
let viewer: { _id: string } | null = null;
vi.mock("@/lib/auth/current-person", () => ({
  resolveViewerPersonId: vi.fn(async () => viewer?._id ?? null),
  requireActingPerson: vi.fn(async (message: string) => {
    if (!viewer) throw new Error(message);
    return { ...viewer, name: "Someone" };
  }),
}));

vi.mock("@/lib/mongo/entities", () => ({
  ensureHostEntityForPerson: vi.fn(async () => "entity-x"),
}));
const listEvents = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mongo/events", () => ({ listEvents }));
const listCalendarsByCircle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mongo/calendars", () => ({ listCalendarsByCircle }));
const ensureCircleConversation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mongo/campfire", () => ({ ensureCircleConversation }));

import {
  createCirclePost,
  ensureCircleConversationAction,
  getCircle,
  getCircleCalendars,
  getCircleEvents,
  getCircleMembers,
  getCirclePosts,
  joinCircle,
  togglePostReaction,
} from "./circle-detail";

// ── fixtures ────────────────────────────────────────────────────────────────

const ANON = null;
const OUTSIDER = { _id: "p-outsider" };
const MEMBER = { _id: "p-member" };
const STAFF = { _id: "p-staff" };
const OWNER = { _id: "p-owner" };
const INVITEE = { _id: "p-invitee" };

const TYPES = ["public", "broadcast", "private", "secret"] as const;
const idFor = (type: string) => `c-${type}`;

function seed() {
  circles = fakeCollection(
    TYPES.map((t) => ({
      _id: idFor(t),
      name: `The ${t} circle`,
      description: `About the ${t} circle`,
      circleType: t,
      isActive: true,
      ownerPersonId: OWNER._id,
      memberCount: 3,
      postCount: 2,
      primaryEventId: "evt-1",
    })),
  );
  circles.docs.push({
    _id: "c-inactive",
    name: "Gone",
    circleType: "public",
    isActive: false,
    ownerPersonId: OWNER._id,
  });
  memberships = fakeCollection(
    TYPES.flatMap((t) => [
      {
        _id: `m-${t}-member`,
        circleId: idFor(t),
        memberPersonId: MEMBER._id,
        role: "member",
        membershipStatus: "active",
      },
      {
        _id: `m-${t}-staff`,
        circleId: idFor(t),
        memberPersonId: STAFF._id,
        role: "moderator",
        membershipStatus: "active",
      },
      {
        _id: `m-${t}-owner`,
        circleId: idFor(t),
        memberPersonId: OWNER._id,
        role: "owner",
        membershipStatus: "active",
      },
    ]),
  );
  memberships.docs.push({
    _id: "m-secret-invitee",
    circleId: idFor("secret"),
    memberPersonId: INVITEE._id,
    role: "member",
    membershipStatus: "invited",
  });
  posts = fakeCollection(
    TYPES.flatMap((t) => [
      {
        _id: `post-${t}-public`,
        circleId: idFor(t),
        authorPersonId: MEMBER._id,
        visibility: "public",
        moderationStatus: "approved",
        articleBody: "hello world",
      },
      {
        _id: `post-${t}-members`,
        circleId: idFor(t),
        authorPersonId: MEMBER._id,
        visibility: "circle_members",
        moderationStatus: "approved",
        articleBody: "members only",
      },
      {
        _id: `post-${t}-removed`,
        circleId: idFor(t),
        authorPersonId: MEMBER._id,
        visibility: "circle_members",
        moderationStatus: "removed",
        articleBody: "removed",
      },
    ]),
  );
  persons = fakeCollection([
    { _id: MEMBER._id, name: "A Member" },
    { _id: OWNER._id, name: "The Owner" },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  viewer = ANON;
  listEvents.mockResolvedValue({ events: [{ id: "evt-1" }] });
  listCalendarsByCircle.mockResolvedValue([]);
  ensureCircleConversation.mockResolvedValue({ _id: "conv-1" });
});

// ── reads ───────────────────────────────────────────────────────────────────

describe("getCircle", () => {
  it("anonymous and non-members get 404 (null) for a secret circle", async () => {
    for (const who of [ANON, OUTSIDER]) {
      viewer = who;
      expect(await getCircle(idFor("secret"))).toBeNull();
    }
  });

  it("members and staff see a secret circle", async () => {
    viewer = MEMBER;
    expect((await getCircle(idFor("secret")))?.viewer.access).toBe("member");
    viewer = STAFF;
    expect((await getCircle(idFor("secret")))?.viewer.access).toBe("staff");
  });

  it("an invitee sees a secret circle's preview and can accept", async () => {
    viewer = INVITEE;
    const c = await getCircle(idFor("secret"));
    expect(c?.viewer.access).toBe("preview");
    expect(c?.viewer.join).toBe("accept_invite");
    expect(c?.viewer.canReadPosts).toBe(false);
  });

  it("non-members get a private circle's preview without member-only fields", async () => {
    for (const who of [ANON, OUTSIDER]) {
      viewer = who;
      const c = await getCircle(idFor("private"));
      expect(c).toMatchObject({
        name: "The private circle",
        description: "About the private circle",
        member_count: 3,
        owner_person_id: null,
        linked_event_id: null,
      });
      expect(c?.viewer).toMatchObject({
        access: "preview",
        canReadPosts: false,
        canSeeEvents: false,
        canSeeMembers: false,
        canPost: false,
        join: "request",
      });
    }
  });

  it("anyone reads a public circle; the owner is flagged as owner", async () => {
    viewer = ANON;
    expect((await getCircle(idFor("public")))?.viewer.access).toBe("reader");
    viewer = OWNER;
    const c = await getCircle(idFor("public"));
    expect(c?.viewer.isOwner).toBe(true);
    expect(c?.owner_person_id).toBe(OWNER._id);
  });

  it("an inactive circle is 404 to everyone, its owner included", async () => {
    viewer = OWNER;
    expect(await getCircle("c-inactive")).toBeNull();
  });
});

describe("getCirclePosts", () => {
  const ids = (list: { id: string }[]) => list.map((p) => p.id).sort();

  it("non-members of private and secret circles get nothing, and nothing is queried", async () => {
    for (const who of [ANON, OUTSIDER]) {
      viewer = who;
      expect(await getCirclePosts(idFor("private"))).toEqual([]);
      expect(await getCirclePosts(idFor("secret"))).toEqual([]);
    }
    expect(posts.find).not.toHaveBeenCalled();
  });

  it("anonymous readers of a public circle see approved public posts only", async () => {
    viewer = ANON;
    expect(ids(await getCirclePosts(idFor("public")))).toEqual([
      "post-public-public",
    ]);
  });

  it("members also see members-only posts, never removed ones", async () => {
    viewer = MEMBER;
    expect(ids(await getCirclePosts(idFor("private")))).toEqual([
      "post-private-members",
      "post-private-public",
    ]);
  });

  it("the removed-post archive is circle staff only", async () => {
    viewer = MEMBER;
    expect(await getCirclePosts(idFor("public"), 20, true)).toEqual([]);
    viewer = STAFF;
    expect(ids(await getCirclePosts(idFor("public"), 20, true))).toEqual([
      "post-public-removed",
    ]);
  });
});

describe("getCircleMembers", () => {
  it("is members only, for every circle type", async () => {
    for (const who of [ANON, OUTSIDER]) {
      viewer = who;
      for (const t of TYPES) {
        expect(await getCircleMembers(idFor(t))).toEqual([]);
      }
    }
    expect(memberships.find).not.toHaveBeenCalled();

    viewer = MEMBER;
    const roster = await getCircleMembers(idFor("secret"));
    expect(roster.map((m) => m.person_id).sort()).toEqual([
      MEMBER._id,
      OWNER._id,
      STAFF._id,
    ]);
  });
});

describe("getCircleEvents / getCircleCalendars", () => {
  it("show a public circle's events and calendars to anyone", async () => {
    viewer = ANON;
    expect(await getCircleEvents(idFor("public"))).toHaveLength(1);
    await getCircleCalendars(idFor("public"));
    expect(listCalendarsByCircle).toHaveBeenCalledWith(idFor("public"));
  });

  it("hide a private or secret circle's events and calendars from non-members", async () => {
    viewer = OUTSIDER;
    for (const t of ["private", "secret"]) {
      expect(await getCircleEvents(idFor(t))).toEqual([]);
      expect(await getCircleCalendars(idFor(t))).toEqual([]);
    }
    expect(listEvents).not.toHaveBeenCalled();
    expect(listCalendarsByCircle).not.toHaveBeenCalled();
  });

  it("show them to members of a private circle", async () => {
    viewer = MEMBER;
    expect(await getCircleEvents(idFor("private"))).toHaveLength(1);
  });
});

// ── writes ──────────────────────────────────────────────────────────────────

describe("createCirclePost", () => {
  const post = (type: string) =>
    createCirclePost({ circleId: idFor(type), text: "Hi all" });

  it("requires a session", async () => {
    viewer = ANON;
    await expect(post("public")).rejects.toThrow(/signed in/);
  });

  it("refuses non-members; a secret circle answers not found", async () => {
    viewer = OUTSIDER;
    await expect(post("public")).rejects.toThrow(/Join this circle/);
    await expect(post("private")).rejects.toThrow(/Join this circle/);
    await expect(post("secret")).rejects.toThrow(
      "This circle could not be found.",
    );
    expect(posts.insertOne).not.toHaveBeenCalled();
  });

  it("lets only staff post in a broadcast circle", async () => {
    viewer = MEMBER;
    await expect(post("broadcast")).rejects.toThrow(/staff/);
    viewer = STAFF;
    await expect(post("broadcast")).resolves.toBeTruthy();
  });

  it("members post; visibility is never public in a private or secret circle", async () => {
    viewer = MEMBER;
    await post("private");
    await post("secret");
    await post("public");
    const vis = posts.insertOne.mock.calls.map(([d]) => [
      d.circleId,
      d.visibility,
    ]);
    expect(vis).toEqual([
      [idFor("private"), "circle_members"],
      [idFor("secret"), "circle_members"],
      [idFor("public"), "public"],
    ]);
  });
});

describe("joinCircle", () => {
  it("public: an outsider joins at once and the count moves", async () => {
    viewer = OUTSIDER;
    expect(await joinCircle({ circleId: idFor("public") })).toBe("active");
    expect(memberships.insertOne.mock.calls[0][0]).toMatchObject({
      memberPersonId: OUTSIDER._id,
      membershipStatus: "active",
    });
    expect(circles.updateOne).toHaveBeenCalledTimes(1);
  });

  it("private: an outsider only requests; the count does not move", async () => {
    viewer = OUTSIDER;
    expect(await joinCircle({ circleId: idFor("private") })).toBe(
      "pending_approval",
    );
    expect(memberships.insertOne.mock.calls[0][0]).toMatchObject({
      membershipStatus: "pending_approval",
      isActive: false,
    });
    expect(circles.updateOne).not.toHaveBeenCalled();
    // Asking again changes nothing.
    expect(await joinCircle({ circleId: idFor("private") })).toBe(
      "pending_approval",
    );
    expect(memberships.insertOne).toHaveBeenCalledTimes(1);
  });

  it("secret: an outsider gets not found; an invitee accepts", async () => {
    viewer = OUTSIDER;
    await expect(joinCircle({ circleId: idFor("secret") })).rejects.toThrow(
      "This circle could not be found.",
    );
    viewer = INVITEE;
    expect(await joinCircle({ circleId: idFor("secret") })).toBe("active");
    expect(
      memberships.docs.find((m) => m._id === "m-secret-invitee"),
    ).toMatchObject({ membershipStatus: "active", isActive: true });
    expect(circles.updateOne).toHaveBeenCalledTimes(1);
  });

  it("a banned person cannot rejoin", async () => {
    memberships.docs.push({
      _id: "m-banned",
      circleId: idFor("public"),
      memberPersonId: OUTSIDER._id,
      role: "member",
      membershipStatus: "banned",
    });
    viewer = OUTSIDER;
    await expect(joinCircle({ circleId: idFor("public") })).rejects.toThrow(
      /can't join/,
    );
  });

  it("is a no-op for an existing member", async () => {
    viewer = MEMBER;
    expect(await joinCircle({ circleId: idFor("private") })).toBe("active");
    expect(memberships.insertOne).not.toHaveBeenCalled();
    expect(memberships.updateOne).not.toHaveBeenCalled();
  });
});

describe("togglePostReaction", () => {
  it("refuses non-members, even on a public post", async () => {
    viewer = OUTSIDER;
    await expect(
      togglePostReaction({ postId: "post-public-public" }),
    ).rejects.toThrow(/Join this circle/);
  });

  it("answers not found for a post the viewer cannot read", async () => {
    viewer = OUTSIDER;
    for (const postId of [
      "post-public-members",
      "post-private-public",
      "post-secret-members",
      "nope",
    ]) {
      await expect(togglePostReaction({ postId })).rejects.toThrow(
        "This post could not be found.",
      );
    }
    viewer = MEMBER;
    await expect(
      togglePostReaction({ postId: "post-public-removed" }),
    ).rejects.toThrow("This post could not be found.");
    expect(posts.updateOne).not.toHaveBeenCalled();
  });

  it("lets a member react to a members-only post", async () => {
    viewer = MEMBER;
    expect(await togglePostReaction({ postId: "post-secret-members" })).toBe(
      "added",
    );
  });
});

describe("ensureCircleConversationAction", () => {
  it("is members only", async () => {
    viewer = OUTSIDER;
    await expect(
      ensureCircleConversationAction(idFor("public")),
    ).rejects.toThrow(/Join this circle/);
    await expect(
      ensureCircleConversationAction(idFor("secret")),
    ).rejects.toThrow("This circle could not be found.");
    expect(ensureCircleConversation).not.toHaveBeenCalled();

    viewer = MEMBER;
    expect(await ensureCircleConversationAction(idFor("private"))).toBe(
      "conv-1",
    );
  });
});
