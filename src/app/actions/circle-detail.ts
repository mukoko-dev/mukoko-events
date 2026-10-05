"use server";

/**
 * Circle detail server actions — Vercel server runtime → MongoDB.
 *
 * Replaces the browser-side Supabase helpers the circle detail page used to call
 * (`getCircle` / `getCirclePosts` / `getCircleMembers` / `createCirclePost` /
 * `joinCircle` / `togglePostReaction`). The browser can't talk to Mongo, so all
 * reads and writes now run here against the `circles` database via the shared
 * accessors in `@/lib/mongo/databases`.
 *
 * Writes resolve the acting person from the AuthKit session (or the local dev
 * bypass) server-side — the client never gets to assert who it is.
 *
 * Access: every read and write first resolves the viewer's membership and
 * runs the circle access policy (`@/lib/circle-access`, the same rules the
 * Nyuchi API enforces). A hidden circle (secret to a non-member, inactive or
 * missing) reads as `null`/empty and every write on it throws the same "not
 * found" error, so its existence never leaks. Private circles show a preview
 * (name, description, counts) to non-members; content is members-only. Reactions
 * are tracked per-person on the post document itself (the v3.1 model has no
 * separate per-user reaction collection), which keeps the toggle honest while
 * staying inside the collections this sweep is allowed to touch.
 */

import {
  circleMembershipsCollection,
  circlePostsCollection,
  circlesCollection,
  personsCollection,
} from "@/lib/mongo/databases";
import { stampNew } from "@/lib/mongo/ids";
import { ensureHostEntityForPerson } from "@/lib/mongo/entities";
import {
  requireActingPerson,
  resolveViewerPersonId,
} from "@/lib/auth/current-person";
import {
  loadCircleAccess,
  type ResolvedCircleAccess,
} from "@/lib/mongo/circle-access";
import {
  canReadPostVisibility,
  defaultPostVisibility,
  type CircleJoinMode,
  type CircleAccessLevel,
} from "@/lib/circle-access";
import { listEvents } from "@/lib/mongo/events";
import { listCalendarsByCircle } from "@/lib/mongo/calendars";
import { ensureCircleConversation } from "@/lib/mongo/campfire";
import type { Event } from "@/lib/api";
import type {
  CircleMembershipDoc,
  CirclePostDoc,
  PersonDoc,
} from "@/lib/mongo/types";

/** One message for every "no such circle / not yours to see" answer. */
const NOT_FOUND = "This circle could not be found.";

const MAX_POST_LENGTH = 5000;

// ── API shapes (kept compatible with the old Supabase helpers) ──────────────

/** Minimal person projection the circle UI renders for authors and members. */
export interface CirclePerson {
  id: string;
  name: string | null;
  givenname: string | null;
  familyname: string | null;
  image: string | null;
}

/** Circle shape the detail page consumes (snake_case, matching the old row). */
export interface CircleDetail {
  id: string;
  name: string;
  description: string | null;
  circle_purpose: string;
  member_count: number | null;
  post_count: number | null;
  linked_event_id: string | null;
  /** Shown to members only; `null` otherwise. */
  owner_person_id: string | null;
  /** What this viewer may see and do — computed on the server. */
  viewer: CircleViewer;
}

/** The viewer's resolved permissions, as plain flags for the UI. */
export interface CircleViewer {
  access: Exclude<CircleAccessLevel, "hidden">;
  isSignedIn: boolean;
  isMember: boolean;
  isOwner: boolean;
  isStaff: boolean;
  canReadPosts: boolean;
  canSeeEvents: boolean;
  canSeeMembers: boolean;
  canPost: boolean;
  canReact: boolean;
  canUseChat: boolean;
  canSeeArchive: boolean;
  join: CircleJoinMode;
}

/** Post shape the detail stream/archive renders. */
export interface CirclePost {
  id: string;
  circle_id: string;
  author_id: string;
  text: string | null;
  post_type: string | null;
  like_count: number | null;
  comment_count: number | null;
  moderation_status: string | null;
  created_at: string | null;
  author: CirclePerson | null;
}

/** Membership shape the members tab renders. */
export interface CircleMember {
  circle_id: string;
  person_id: string;
  role: string;
  status: string;
  joined_at: string | null;
  person: CirclePerson | null;
}

// ── Mappers ─────────────────────────────────────────────────────────────────

function mapPerson(doc: PersonDoc): CirclePerson {
  return {
    id: doc._id,
    name: doc.name ?? null,
    givenname: doc.givenName ?? null,
    familyname: doc.familyName ?? null,
    image: doc.picture ?? null,
  };
}

function mapCircle(
  resolved: ResolvedCircleAccess,
  viewerPersonId: string | null,
): CircleDetail {
  const { circle: doc, permissions: p } = resolved;
  const isMember = p.access === "member" || p.access === "staff";
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description ?? null,
    // The v3.1 circle has no distinct "purpose" field; surface the description
    // so the hero's `description || circle_purpose` fallback still renders.
    circle_purpose: doc.description ?? "",
    member_count: doc.memberCount ?? null,
    post_count: doc.postCount ?? null,
    linked_event_id: isMember ? (doc.primaryEventId ?? null) : null,
    owner_person_id: isMember ? doc.ownerPersonId : null,
    viewer: {
      access: p.access as CircleViewer["access"],
      isSignedIn: viewerPersonId !== null,
      isMember,
      isOwner: viewerPersonId !== null && doc.ownerPersonId === viewerPersonId,
      isStaff: p.access === "staff",
      canReadPosts: p.canReadPosts,
      canSeeEvents: p.canSeeEvents,
      canSeeMembers: p.canSeeMembers,
      canPost: p.canPost,
      canReact: p.canReact,
      canUseChat: p.canUseChat,
      canSeeArchive: p.canSeeArchive,
      join: p.join,
    },
  };
}

function mapPost(doc: CirclePostDoc, author: CirclePerson | null): CirclePost {
  return {
    id: doc._id,
    circle_id: doc.circleId,
    author_id: doc.authorPersonId,
    text: doc.articleBody ?? null,
    post_type: doc.postType ?? null,
    like_count: doc.reactionCount ?? 0,
    comment_count: doc.commentCount ?? 0,
    moderation_status: doc.moderationStatus ?? null,
    created_at: (doc.datePublished ?? doc.createdAt)?.toISOString() ?? null,
    author,
  };
}

/** Resolve a batch of persons keyed by `_id` for author/member hydration. */
async function hydratePersons(
  ids: string[],
): Promise<Map<string, CirclePerson>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const persons = await personsCollection();
  const docs = await persons.find({ _id: { $in: unique } }).toArray();
  return new Map(docs.map((d) => [d._id, mapPerson(d)]));
}

// ── Access resolution ───────────────────────────────────────────────────────

/** The viewer's access to a circle for a READ (anonymous allowed). */
async function viewerAccess(circleId: string): Promise<{
  viewerPersonId: string | null;
  resolved: ResolvedCircleAccess | null;
}> {
  const viewerPersonId = await resolveViewerPersonId();
  const resolved = await loadCircleAccess(circleId, viewerPersonId);
  return { viewerPersonId, resolved };
}

/** The signed-in person and their access, for a WRITE. Throws when the
 *  circle is hidden from them (the same message as a missing circle). */
async function actingAccess(
  circleId: string,
): Promise<{ person: PersonDoc; resolved: ResolvedCircleAccess }> {
  const person = await requireActingPerson("You must be signed in to do that.");
  const resolved = await loadCircleAccess(circleId, person._id);
  if (!resolved) throw new Error(NOT_FOUND);
  return { person, resolved };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * The circle as this viewer may see it, with their permission flags. `null`
 * when it does not exist, is inactive, or is hidden from them.
 */
export async function getCircle(
  circleId: string,
): Promise<CircleDetail | null> {
  try {
    const { viewerPersonId, resolved } = await viewerAccess(circleId);
    return resolved ? mapCircle(resolved, viewerPersonId) : null;
  } catch (err) {
    console.warn("[mukoko] getCircle failed:", err);
    return null;
  }
}

/**
 * The circle's upcoming events (events.events.circleId) — the primary lens
 * Mukoko Events presents a circle through. Public listing rules apply
 * (published, non-private, upcoming). Public and broadcast circles show them
 * to anyone; private and secret circles to members only.
 */
export async function getCircleEvents(
  circleId: string,
  limit = 50,
): Promise<Event[]> {
  try {
    const { resolved } = await viewerAccess(circleId);
    if (!resolved?.permissions.canSeeEvents) return [];
    const { events } = await listEvents({ circleId, limit });
    return events;
  } catch (err) {
    console.warn("[mukoko] getCircleEvents failed:", err);
    return [];
  }
}

/** The small shape the circle's "Calendars" tab renders. */
export interface CircleCalendarSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  theme: string | null;
  followerCount: number;
  eventCount: number;
}

/** Public/unlisted calendars streaming through this circle (same gate as
 *  its events). */
export async function getCircleCalendars(
  circleId: string,
): Promise<CircleCalendarSummary[]> {
  try {
    const { resolved } = await viewerAccess(circleId);
    if (!resolved?.permissions.canSeeEvents) return [];
    const docs = await listCalendarsByCircle(circleId);
    return docs.map((d) => ({
      id: d._id,
      slug: d.slug,
      name: d.name,
      description: d.description ?? null,
      theme: d.theme ?? null,
      followerCount: d.followerCount,
      eventCount: d.eventCount,
    }));
  } catch (err) {
    console.warn("[mukoko] getCircleCalendars failed:", err);
    return [];
  }
}

/**
 * The post stream the viewer may read. Readers of a public or broadcast
 * circle see approved `public` posts; members also see `circle_members`
 * posts; circle staff also see `circle_admins_only` posts and the moderation
 * states. `archived` (removed posts) is circle staff only.
 */
export async function getCirclePosts(
  circleId: string,
  limit = 20,
  archived = false,
): Promise<CirclePost[]> {
  try {
    const { resolved } = await viewerAccess(circleId);
    if (!resolved?.permissions.canReadPosts) return [];
    const { permissions } = resolved;
    if (archived && !permissions.canSeeArchive) return [];

    const isStaff = permissions.access === "staff";
    const filter: Record<string, unknown> = {
      circleId,
      visibility: { $in: permissions.readablePostVisibilities },
      moderationStatus: archived
        ? "removed"
        : isStaff
          ? { $ne: "removed" }
          : "approved",
    };
    const posts = await circlePostsCollection();
    const docs = await posts
      .find(filter)
      .sort({ datePublished: -1, createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
    const byId = await hydratePersons(docs.map((d) => d.authorPersonId));
    return docs.map((d) => mapPost(d, byId.get(d.authorPersonId) ?? null));
  } catch (err) {
    console.warn("[mukoko] getCirclePosts failed:", err);
    return [];
  }
}

/** The active roster — members only, for every circle type. */
export async function getCircleMembers(
  circleId: string,
  limit = 50,
): Promise<CircleMember[]> {
  try {
    const { resolved } = await viewerAccess(circleId);
    if (!resolved?.permissions.canSeeMembers) return [];
    const memberships = await circleMembershipsCollection();
    const docs = await memberships
      .find({ circleId, membershipStatus: "active" })
      .sort({ joinedAt: 1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .toArray();
    const byId = await hydratePersons(docs.map((d) => d.memberPersonId));
    return docs.map((d) => ({
      circle_id: d.circleId,
      person_id: d.memberPersonId,
      role: d.role,
      status: d.membershipStatus,
      joined_at: d.joinedAt?.toISOString() ?? null,
      person: byId.get(d.memberPersonId) ?? null,
    }));
  } catch (err) {
    console.warn("[mukoko] getCircleMembers failed:", err);
    return [];
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Post to the stream. Members only; in a broadcast circle, staff only. */
export async function createCirclePost(input: {
  circleId: string;
  text: string;
  postType?: string;
}): Promise<CirclePost> {
  const text = input.text?.trim() ?? "";
  if (!text) throw new Error("Write something before posting.");
  if (text.length > MAX_POST_LENGTH) {
    throw new Error(`Posts must be ${MAX_POST_LENGTH} characters or fewer.`);
  }

  const { person, resolved } = await actingAccess(input.circleId);
  if (!resolved.permissions.canPost) {
    throw new Error(
      resolved.permissions.access === "member"
        ? "Only the circle's staff can post here."
        : "Join this circle to post.",
    );
  }

  const authorEntityId = await ensureHostEntityForPerson(person);
  const now = new Date();

  const doc: CirclePostDoc = {
    ...stampNew(),
    circleId: input.circleId,
    authorPersonId: person._id,
    authorEntityId,
    schemaOrgType: "SocialMediaPosting",
    postType: input.postType ?? "text",
    inLanguage: "en",
    moderationStatus: "approved",
    isPinned: false,
    // Public in public/broadcast circles; never public in private/secret.
    visibility: defaultPostVisibility(resolved.circle.circleType),
    commentCount: 0,
    reactionCount: 0,
    viewCount: 0,
    datePublished: now,
    articleBody: text,
  } as CirclePostDoc;

  const posts = await circlePostsCollection();
  await posts.insertOne(doc);

  // Keep the circle's denormalised post count moving.
  const circles = await circlesCollection();
  await circles.updateOne(
    { _id: input.circleId },
    { $inc: { postCount: 1 }, $set: { updatedAt: now } },
  );

  return mapPost(doc, mapPerson(person));
}

/**
 * Resolve (creating on first use) the circle's paired group chat — its
 * WhatsApp-style Discuss channel, distinct from the persistent post stream
 * above. Members only (the API's rule for `POST /circles/{id}/conversation`).
 */
export async function ensureCircleConversationAction(
  circleId: string,
): Promise<string> {
  const { person, resolved } = await actingAccess(circleId);
  if (!resolved.permissions.canUseChat) {
    throw new Error("Join this circle to open its chat.");
  }

  const conversation = await ensureCircleConversation({
    circleId,
    circleName: resolved.circle.name,
    createdByPersonId: person._id,
  });
  return conversation._id;
}

/** What a join attempt resulted in. */
export type JoinCircleResult = "active" | "pending_approval";

/**
 * Join, follow, request or accept an invitation, by circle type:
 *
 * - public / broadcast: join at once.
 * - private: a join *request* (`pending_approval`); circle staff approve it.
 *   The member count does not move until then.
 * - secret: only with a waiting invitation, which this accepts.
 *
 * A banned person cannot rejoin. Joining a circle you are already in is a
 * no-op.
 */
export async function joinCircle(input: {
  circleId: string;
}): Promise<JoinCircleResult> {
  const { person, resolved } = await actingAccess(input.circleId);
  const { permissions, membership: existing } = resolved;

  if (permissions.access === "member" || permissions.access === "staff") {
    return "active";
  }
  const mode = permissions.join;
  if (mode === null) {
    throw new Error("You can't join this circle.");
  }
  if (mode === "requested") return "pending_approval";

  const nextStatus: JoinCircleResult =
    mode === "request" ? "pending_approval" : "active";
  const now = new Date();
  const memberships = await circleMembershipsCollection();

  if (existing) {
    // Compare-and-set on the old status so a repeated request never counts
    // twice (and never resurrects a ban that landed in between).
    const res = await memberships.updateOne(
      { _id: existing._id, membershipStatus: existing.membershipStatus },
      {
        $set: {
          membershipStatus: nextStatus,
          isActive: nextStatus === "active",
          joinedAt: now,
          updatedAt: now,
          leftAt: null,
        },
      },
    );
    if (nextStatus === "active" && res.modifiedCount > 0) {
      await bumpMemberCount(input.circleId, 1, now);
    }
    return nextStatus;
  }

  const memberEntityId = await ensureHostEntityForPerson(person);
  const doc: CircleMembershipDoc = {
    ...stampNew(),
    circleId: input.circleId,
    memberPersonId: person._id,
    memberEntityId,
    role: "member",
    membershipStatus: nextStatus,
    isActive: nextStatus === "active",
    joinedAt: now,
  } as CircleMembershipDoc;
  await memberships.insertOne(doc);
  if (nextStatus === "active") {
    await bumpMemberCount(input.circleId, 1, now);
  }
  return nextStatus;
}

async function bumpMemberCount(
  circleId: string,
  delta: number,
  now: Date,
): Promise<void> {
  const circles = await circlesCollection();
  await circles.updateOne(
    { _id: circleId },
    { $inc: { memberCount: delta }, $set: { updatedAt: now } },
  );
}

/**
 * Toggle the acting person's reaction on a post. Members only, and only on a
 * post they can read. The v3.1 model has no separate per-user reaction
 * collection, so reactors are tracked in a `reactorPersonIds` array on the
 * post doc and `reactionCount` is kept in sync. Returns whether the reaction
 * was added or removed so the client can adjust its optimistic count.
 */
export async function togglePostReaction(input: {
  postId: string;
}): Promise<"added" | "removed"> {
  const person = await requireActingPerson("You must be signed in to do that.");
  const posts = await circlePostsCollection();
  const post = await posts.findOne({ _id: input.postId });
  const notFound = "This post could not be found.";
  if (!post) throw new Error(notFound);

  const resolved = await loadCircleAccess(post.circleId, person._id);
  if (
    !resolved ||
    !canReadPostVisibility(resolved.permissions, post.visibility) ||
    post.moderationStatus === "removed"
  ) {
    throw new Error(notFound);
  }
  if (!resolved.permissions.canReact) {
    throw new Error("Join this circle to react.");
  }

  const now = new Date();
  const reactors: unknown = (post as { reactorPersonIds?: unknown })
    .reactorPersonIds;
  const already = Array.isArray(reactors) && reactors.includes(person._id);

  // `reactorPersonIds` is an extra field beyond the canonical CirclePostDoc;
  // the validators allow extra fields. Update it via a loosened filter, and
  // only when the array still agrees, so a double tap can't double count.
  if (already) {
    await posts.updateOne(
      {
        _id: input.postId,
        reactorPersonIds: person._id,
      } as Record<string, unknown>,
      {
        $pull: { reactorPersonIds: person._id },
        $inc: { reactionCount: -1 },
        $set: { updatedAt: now },
      } as Record<string, unknown>,
    );
    return "removed";
  }

  await posts.updateOne(
    {
      _id: input.postId,
      reactorPersonIds: { $ne: person._id },
    } as Record<string, unknown>,
    {
      $addToSet: { reactorPersonIds: person._id },
      $inc: { reactionCount: 1 },
      $set: { updatedAt: now },
    } as Record<string, unknown>,
  );
  return "added";
}
