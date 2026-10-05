/**
 * Circle detail server actions, Nyuchi API path (key set) — the same
 * per-audience matrix as circle-detail.test.ts (anonymous, non-member,
 * member, circle staff, invitee, banned) on each circle type.
 *
 * The real actions, the real access policy and the real API-backed loader
 * run against a small fake of `/v1/circles` that applies the API's rules
 * (nyuchi/api-gateway `gateway/routers/circles.py`): a secret circle is 404
 * to anyone but its members and invitees, content reads need read access,
 * and `GET /v1/circles/{id}` returns the caller's `viewerMembership`. MongoDB
 * is never touched for a circle on this path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown> & { _id: string };

const ANON = null;
const OUTSIDER = "p-outsider";
const MEMBER = "p-member";
const STAFF = "p-staff";
const OWNER = "p-owner";
const INVITEE = "p-invitee";

const TYPES = ["public", "broadcast", "private", "secret"] as const;
const idFor = (type: string) => `c-${type}`;

let circles: Row[] = [];
let memberships: Row[] = [];
let posts: Row[] = [];
let reactions: { postId: string; personId: string }[] = [];
let calls: {
  method: string;
  path: string;
  as: string | null;
  body?: unknown;
}[] = [];

function seed() {
  circles = TYPES.map((t) => ({
    _id: idFor(t),
    name: `The ${t} circle`,
    description: `About the ${t} circle`,
    circleType: t,
    isActive: true,
    ownerPersonId: OWNER,
    memberCount: 3,
    postCount: 2,
    primaryEventId: "evt-1",
  }));
  circles.push({
    _id: "c-inactive",
    name: "Gone",
    circleType: "public",
    isActive: false,
    ownerPersonId: OWNER,
  });
  memberships = TYPES.flatMap((t) => [
    {
      _id: `m-${t}-member`,
      circleId: idFor(t),
      memberPersonId: MEMBER,
      role: "member",
      membershipStatus: "active",
    },
    {
      _id: `m-${t}-staff`,
      circleId: idFor(t),
      memberPersonId: STAFF,
      role: "moderator",
      membershipStatus: "active",
    },
    {
      _id: `m-${t}-owner`,
      circleId: idFor(t),
      memberPersonId: OWNER,
      role: "owner",
      membershipStatus: "active",
    },
  ]);
  memberships.push({
    _id: "m-secret-invitee",
    circleId: idFor("secret"),
    memberPersonId: INVITEE,
    role: "member",
    membershipStatus: "invited",
  });
  posts = TYPES.flatMap((t) => [
    {
      _id: `post-${t}-public`,
      circleId: idFor(t),
      authorPersonId: MEMBER,
      visibility: "public",
      moderationStatus: "approved",
      articleBody: "hello world",
    },
    {
      _id: `post-${t}-members`,
      circleId: idFor(t),
      authorPersonId: MEMBER,
      visibility: "circle_members",
      moderationStatus: "approved",
      articleBody: "members only",
    },
    {
      _id: `post-${t}-flagged`,
      circleId: idFor(t),
      authorPersonId: MEMBER,
      visibility: "circle_members",
      moderationStatus: "flagged",
      articleBody: "flagged",
    },
  ]);
  reactions = [];
  calls = [];
}

// ── a fake /v1 with the API's circle rules ──────────────────────────────────

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const STAFF_ROLES = ["owner", "admin", "moderator"];
const OPEN = ["public", "broadcast"];

function access(circleId: string, who: string | null) {
  const circle = circles.find((c) => c._id === circleId);
  if (!circle || circle.isActive === false)
    throw new FakeApiError(404, "Circle not found");
  const m =
    memberships.find(
      (r) => r.circleId === circleId && r.memberPersonId === who,
    ) ?? null;
  const status = (m?.membershipStatus as string) ?? null;
  if (
    circle.circleType === "secret" &&
    !["active", "invited"].includes(status ?? "")
  )
    throw new FakeApiError(404, "Circle not found");
  const isMember = status === "active";
  const isStaff = isMember && STAFF_ROLES.includes(m?.role as string);
  const canRead = isMember || OPEN.includes(circle.circleType as string);
  const readable = isStaff
    ? ["public", "circle_members", "circle_admins_only"]
    : isMember
      ? ["public", "circle_members"]
      : ["public"];
  return { circle, m, status, isMember, isStaff, canRead, readable };
}

function requireRead(a: ReturnType<typeof access>) {
  if (!a.canRead)
    throw new FakeApiError(403, "This circle's content is for its members");
}

async function handle(
  method: string,
  path: string,
  who: string | null,
  body?: unknown,
) {
  calls.push({ method, path, as: who, body });
  const url = new URL(path, "https://api.test");
  const parts = url.pathname.split("/").filter(Boolean); // v1 circles {id} …
  if (parts[1] === "identity") {
    return { data: { id: parts[3], display_name: `Name of ${parts[3]}` } };
  }
  const [, , circleId, sub, postId, leaf] = parts;
  const a = access(circleId, who);
  if (method === "GET" && !sub) {
    return {
      ...a.circle,
      viewerMembership: a.m
        ? { role: a.m.role, membershipStatus: a.m.membershipStatus }
        : null,
    };
  }
  if (method === "GET" && sub === "posts" && !postId) {
    requireRead(a);
    return {
      data: posts.filter(
        (p) =>
          p.circleId === circleId &&
          p.moderationStatus === "approved" &&
          a.readable.includes(p.visibility as string),
      ),
    };
  }
  if (method === "GET" && sub === "posts" && postId) {
    requireRead(a);
    const p = posts.find((x) => x._id === postId && x.circleId === circleId);
    if (
      !p ||
      p.moderationStatus !== "approved" ||
      !a.readable.includes(p.visibility as string)
    )
      throw new FakeApiError(404, "Post not found");
    const mine = reactions.some(
      (r) => r.postId === postId && r.personId === who,
    );
    return { ...p, viewerReaction: mine ? "like" : null };
  }
  if (method === "GET" && sub === "moderation") {
    if (!a.isStaff) throw new FakeApiError(403, "Staff only");
    return {
      data: posts.filter(
        (p) =>
          p.circleId === circleId &&
          ["pending", "flagged"].includes(p.moderationStatus as string),
      ),
    };
  }
  if (method === "GET" && sub === "members") {
    requireRead(a);
    return {
      data: memberships.filter(
        (m) => m.circleId === circleId && m.membershipStatus === "active",
      ),
    };
  }
  if (method === "POST" && sub === "posts") {
    if (!a.isMember)
      throw new FakeApiError(403, "You are not a member of this circle");
    if (a.circle.circleType === "broadcast" && !a.isStaff)
      throw new FakeApiError(
        403,
        "Only the circle's staff post in a broadcast circle",
      );
    const b = body as { article_body: string };
    const doc = {
      _id: `new-${posts.length}`,
      circleId,
      authorPersonId: who,
      articleBody: b.article_body,
      visibility: OPEN.includes(a.circle.circleType as string)
        ? "public"
        : "circle_members",
      moderationStatus: "approved",
    };
    posts.push(doc);
    return doc;
  }
  if (method === "POST" && sub === "join") {
    if (a.status === "banned")
      throw new FakeApiError(403, "You have been banned from this circle");
    if (a.status === "active" || a.status === "pending_approval")
      return { membership: a.m };
    const next =
      a.status === "invited"
        ? "active"
        : a.circle.circleType === "private"
          ? "pending_approval"
          : "active";
    if (a.m) a.m.membershipStatus = next;
    else
      memberships.push({
        _id: `m-${memberships.length}`,
        circleId,
        memberPersonId: who,
        role: "member",
        membershipStatus: next,
      });
    return {
      membership: {
        circleId,
        memberPersonId: who,
        role: "member",
        membershipStatus: next,
      },
    };
  }
  if (sub === "posts" && leaf === "reaction") {
    if (!a.isMember)
      throw new FakeApiError(403, "You are not a member of this circle");
    if (method === "PUT") reactions.push({ postId, personId: who as string });
    else
      reactions = reactions.filter(
        (r) => !(r.postId === postId && r.personId === who),
      );
    return { reaction: method === "PUT" ? "like" : null };
  }
  if (method === "POST" && sub === "conversation") {
    if (!a.isMember)
      throw new FakeApiError(403, "You are not a member of this circle");
    return { conversation: { _id: `conv-${circleId}` }, created: false };
  }
  throw new FakeApiError(404, `No route ${method} ${path}`);
}

const NyuchiApiErrorRef = vi.hoisted(() => ({ ctor: null as unknown }));

function fakeApi(who: string | null) {
  const call = async (method: string, path: string, body?: unknown) => {
    try {
      return await handle(method, path, who, body);
    } catch (err) {
      if (err instanceof FakeApiError) {
        const Ctor = NyuchiApiErrorRef.ctor as new (
          s: number,
          m: string,
        ) => Error;
        throw new Ctor(err.status, err.message);
      }
      throw err;
    }
  };
  return {
    get: (p: string) => call("GET", p),
    post: (p: string, b?: unknown) => call("POST", p, b ?? {}),
    put: (p: string, b?: unknown) => call("PUT", p, b ?? {}),
    patch: (p: string, b?: unknown) => call("PATCH", p, b ?? {}),
    delete: (p: string) => call("DELETE", p),
  };
}

// The session: who is looking.
let viewer: string | null = null;

vi.mock("@/lib/nyuchi-api/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/nyuchi-api/client")>();
  NyuchiApiErrorRef.ctor = actual.NyuchiApiError;
  return {
    ...actual,
    isNyuchiApiConfigured: () => true,
    asService: vi.fn(() => fakeApi("service:mukoko-events")),
  };
});
vi.mock("@/lib/nyuchi-api/session", () => ({
  personApi: vi.fn(async () => {
    if (!viewer) throw new Error("You must be signed in to do that.");
    return fakeApi(viewer);
  }),
  optionalPersonApi: vi.fn(async () => (viewer ? fakeApi(viewer) : null)),
}));

// MongoDB must not be read or written for a circle on this path.
const mongoTouched = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mongo/databases", () => ({
  circlesCollection: vi.fn(async () => mongoTouched("circles")),
  circleMembershipsCollection: vi.fn(async () => mongoTouched("memberships")),
  circlePostsCollection: vi.fn(async () => mongoTouched("posts")),
  personsCollection: vi.fn(async () => mongoTouched("persons")),
}));
vi.mock("@/lib/auth/current-person", () => ({
  resolveViewerPersonId: vi.fn(async () => mongoTouched("viewer")),
  requireActingPerson: vi.fn(async () => mongoTouched("acting")),
}));
vi.mock("@/lib/mongo/entities", () => ({ ensureHostEntityForPerson: vi.fn() }));
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

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  viewer = ANON;
  listEvents.mockResolvedValue({ events: [{ id: "evt-1" }] });
  listCalendarsByCircle.mockResolvedValue([]);
});

const contentCalls = () =>
  calls.filter((c) => /\/(posts|members|moderation)/.test(c.path));

// ── reads ───────────────────────────────────────────────────────────────────

describe("getCircle (API)", () => {
  it("reads as the person when signed in, with the machine token when not", async () => {
    viewer = MEMBER;
    await getCircle(idFor("public"));
    viewer = ANON;
    await getCircle(idFor("public"));
    expect(calls.map((c) => c.as)).toEqual([MEMBER, "service:mukoko-events"]);
  });

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
        member_count: 3,
        owner_person_id: null,
        linked_event_id: null,
      });
      expect(c?.viewer).toMatchObject({
        access: "preview",
        isSignedIn: who !== null,
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
    expect(c?.owner_person_id).toBe(OWNER);
  });

  it("an inactive circle is 404 to everyone, its owner included", async () => {
    viewer = OWNER;
    expect(await getCircle("c-inactive")).toBeNull();
  });
});

describe("getCirclePosts (API)", () => {
  const ids = (list: { id: string }[]) => list.map((p) => p.id).sort();

  it("non-members of private and secret circles get nothing, and nothing is asked for", async () => {
    for (const who of [ANON, OUTSIDER]) {
      viewer = who;
      expect(await getCirclePosts(idFor("private"))).toEqual([]);
      expect(await getCirclePosts(idFor("secret"))).toEqual([]);
    }
    expect(contentCalls()).toEqual([]);
  });

  it("anonymous readers of a public circle see public posts only", async () => {
    viewer = ANON;
    expect(ids(await getCirclePosts(idFor("public")))).toEqual([
      "post-public-public",
    ]);
  });

  it("members also see members-only posts, with authors' public names", async () => {
    viewer = MEMBER;
    const list = await getCirclePosts(idFor("private"));
    expect(ids(list)).toEqual(["post-private-members", "post-private-public"]);
    expect(list[0].author?.name).toBe(`Name of ${MEMBER}`);
  });

  it("the moderation archive is circle staff only", async () => {
    viewer = MEMBER;
    expect(await getCirclePosts(idFor("public"), 20, true)).toEqual([]);
    viewer = STAFF;
    expect(ids(await getCirclePosts(idFor("public"), 20, true))).toEqual([
      "post-public-flagged",
    ]);
  });
});

describe("getCircleMembers (API)", () => {
  it("is members only, for every circle type", async () => {
    for (const who of [ANON, OUTSIDER]) {
      viewer = who;
      for (const t of TYPES)
        expect(await getCircleMembers(idFor(t))).toEqual([]);
    }
    expect(contentCalls()).toEqual([]);

    viewer = MEMBER;
    const roster = await getCircleMembers(idFor("secret"));
    expect(roster.map((m) => m.person_id).sort()).toEqual([
      MEMBER,
      OWNER,
      STAFF,
    ]);
  });
});

describe("getCircleEvents / getCircleCalendars (API gate)", () => {
  it("show a public circle's events to anyone; hide a private or secret circle's from non-members", async () => {
    viewer = ANON;
    expect(await getCircleEvents(idFor("public"))).toHaveLength(1);
    viewer = OUTSIDER;
    for (const t of ["private", "secret"]) {
      expect(await getCircleEvents(idFor(t))).toEqual([]);
      expect(await getCircleCalendars(idFor(t))).toEqual([]);
    }
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(listCalendarsByCircle).not.toHaveBeenCalled();
    viewer = MEMBER;
    expect(await getCircleEvents(idFor("private"))).toHaveLength(1);
  });
});

// ── writes ──────────────────────────────────────────────────────────────────

describe("createCirclePost (API)", () => {
  const post = (type: string) =>
    createCirclePost({ circleId: idFor(type), text: "Hi all" });
  const writes = () => calls.filter((c) => c.method !== "GET");

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
    expect(writes()).toEqual([]);
  });

  it("lets only staff post in a broadcast circle", async () => {
    viewer = MEMBER;
    await expect(post("broadcast")).rejects.toThrow(/staff/);
    viewer = STAFF;
    await expect(post("broadcast")).resolves.toBeTruthy();
  });

  it("members post through the API, as themselves; MongoDB is not written", async () => {
    viewer = MEMBER;
    const p = await post("private");
    expect(p.text).toBe("Hi all");
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `/v1/circles/${idFor("private")}/posts`,
        as: MEMBER,
        body: { article_body: "Hi all", post_type: "discussion" },
      },
    ]);
    expect(mongoTouched).not.toHaveBeenCalled();
  });
});

describe("joinCircle (API)", () => {
  it("public: an outsider joins at once", async () => {
    viewer = OUTSIDER;
    expect(await joinCircle({ circleId: idFor("public") })).toBe("active");
  });

  it("private: an outsider only requests; asking again changes nothing", async () => {
    viewer = OUTSIDER;
    expect(await joinCircle({ circleId: idFor("private") })).toBe(
      "pending_approval",
    );
    expect(await joinCircle({ circleId: idFor("private") })).toBe(
      "pending_approval",
    );
    expect(calls.filter((c) => c.path.endsWith("/join"))).toHaveLength(1);
  });

  it("secret: an outsider gets not found; an invitee accepts", async () => {
    viewer = OUTSIDER;
    await expect(joinCircle({ circleId: idFor("secret") })).rejects.toThrow(
      "This circle could not be found.",
    );
    viewer = INVITEE;
    expect(await joinCircle({ circleId: idFor("secret") })).toBe("active");
  });

  it("a banned person cannot rejoin", async () => {
    memberships.push({
      _id: "m-banned",
      circleId: idFor("public"),
      memberPersonId: OUTSIDER,
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
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("togglePostReaction (API)", () => {
  const toggle = (type: string, postId: string) =>
    togglePostReaction({ circleId: idFor(type), postId });

  it("refuses non-members, even on a public post", async () => {
    viewer = OUTSIDER;
    await expect(toggle("public", "post-public-public")).rejects.toThrow(
      /Join this circle/,
    );
  });

  it("answers not found for a post the viewer cannot read", async () => {
    viewer = OUTSIDER;
    await expect(toggle("public", "post-public-members")).rejects.toThrow(
      "This post could not be found.",
    );
    await expect(toggle("private", "post-private-public")).rejects.toThrow(
      "This post could not be found.",
    );
    await expect(toggle("secret", "post-secret-members")).rejects.toThrow(
      "This post could not be found.",
    );
    await expect(
      togglePostReaction({ postId: "post-public-public" }),
    ).rejects.toThrow("This post could not be found.");
    expect(calls.filter((c) => c.path.endsWith("/reaction"))).toEqual([]);
  });

  it("a member's like toggles on, then off", async () => {
    viewer = MEMBER;
    expect(await toggle("secret", "post-secret-members")).toBe("added");
    expect(await toggle("secret", "post-secret-members")).toBe("removed");
  });
});

describe("ensureCircleConversationAction (API)", () => {
  it("is members only, and the API pairs the chat", async () => {
    viewer = OUTSIDER;
    await expect(
      ensureCircleConversationAction(idFor("public")),
    ).rejects.toThrow(/Join this circle/);
    await expect(
      ensureCircleConversationAction(idFor("secret")),
    ).rejects.toThrow("This circle could not be found.");
    viewer = MEMBER;
    expect(await ensureCircleConversationAction(idFor("private"))).toBe(
      `conv-${idFor("private")}`,
    );
    expect(ensureCircleConversation).not.toHaveBeenCalled();
  });
});
