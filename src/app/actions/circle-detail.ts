"use server";

/**
 * Circle detail server actions.
 *
 * Two backends, one policy. With Mukoko Events' Nyuchi API key set
 * (`NYUCHI_API_CLIENT_ID` / `NYUCHI_API_CLIENT_SECRET`), every circle read and
 * write goes through `/v1/circles` as the signed-in person — the API is the
 * single writer of circles (mukoko-dev/mukoko-events#154). Without it, the
 * server-side MongoDB path below stays in use. The switch is
 * `circlesViaApi()`; nothing falls back from one to the other at runtime.
 *
 * Access: every read and write first resolves the viewer's membership — from
 * the API's `viewerMembership`, or the MongoDB row — and runs the circle
 * access policy (`@/lib/circle-access`, the rules the API enforces). A hidden
 * circle (secret to a non-member, inactive or missing) reads as `null`/empty
 * and every write on it throws the same "not found" error, so its existence
 * never leaks. Private circles show a preview (name, description, counts) to
 * non-members; content is members-only.
 *
 * The person acting is resolved server-side from the AuthKit session (or the
 * local dev bypass, MongoDB path only) — the client never asserts who it is.
 */

import {
  circleMembershipsCollection,
  circlePostsCollection,
  circlesCollection,
  personsCollection,
} from "@/lib/mongo/databases";
import { stampNew } from "@/lib/mongo/ids";
import { ensureHostEntityForPerson } from "@/lib/mongo/entities";
import { requireActingPerson } from "@/lib/auth/current-person";
import { loadCircleAccess } from "@/lib/mongo/circle-access";
import {
  CIRCLE_NOT_FOUND,
  actingCircleAccess,
  circlesViaApi,
  viewerCircleAccess,
  type ResolvedCircleAccess,
} from "@/lib/viewer-circle-access";
import {
  NyuchiApiError,
  asService,
  type NyuchiApi,
} from "@/lib/nyuchi-api/client";
import { optionalPersonApi, personApi } from "@/lib/nyuchi-api/session";
import {
  circlesPath,
  listOf,
  personProfiles,
  unwrap,
  viewerReactionOf,
  type ApiMembership,
  type ApiPersonProfile,
  type ApiPost,
} from "@/lib/nyuchi-api/circles";
import { loadCircleAccessViaApi } from "@/lib/nyuchi-api/circle-access";
import {
  canReadPostVisibility,
  defaultPostVisibility,
  normaliseCircleType,
  type CircleType,
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
const NOT_FOUND = CIRCLE_NOT_FOUND;
const POST_NOT_FOUND = "This post could not be found.";

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
  /** The circle's web address on circles.mukoko.com, when it has one. */
  slug: string | null;
  circle_type: CircleType;
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
  signedIn: boolean,
  viewerPersonId: string | null,
): CircleDetail {
  const { circle: doc, permissions: p, membership } = resolved;
  const isMember = p.access === "member" || p.access === "staff";
  // The owner by their membership role (the API path), or by person id.
  const isOwner =
    isMember &&
    (membership?.role === "owner" ||
      (viewerPersonId !== null && doc.ownerPersonId === viewerPersonId));
  return {
    id: doc._id,
    name: doc.name,
    slug: doc.slug ?? null,
    circle_type: normaliseCircleType(doc.circleType),
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
      isSignedIn: signedIn,
      isMember,
      isOwner,
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

function mapApiPost(doc: ApiPost, author: CirclePerson | null): CirclePost {
  return {
    id: doc._id,
    circle_id: doc.circleId,
    author_id: doc.authorPersonId,
    text: doc.articleBody ?? doc.headline ?? null,
    post_type: doc.postType ?? null,
    like_count: doc.reactionCount ?? 0,
    comment_count: doc.commentCount ?? 0,
    moderation_status: doc.moderationStatus ?? null,
    created_at: doc.datePublished ?? doc.createdAt ?? null,
    author,
  };
}

function mapApiPerson(profile: ApiPersonProfile): CirclePerson {
  return {
    id: profile.id,
    name: profile.display_name ?? profile.username ?? null,
    givenname: null,
    familyname: null,
    image: profile.avatar_url ?? null,
  };
}

/** Public profiles for authors and members (API path). */
async function hydrateViaApi(
  api: NyuchiApi,
  ids: string[],
): Promise<Map<string, CirclePerson>> {
  const profiles = await personProfiles(api, ids);
  return new Map([...profiles].map(([id, p]) => [id, mapApiPerson(p)]));
}

/** A person-facing sentence for an API refusal on a write. */
function apiWriteError(err: unknown, fallback: string): Error {
  if (err instanceof NyuchiApiError) {
    if (err.status === 404) return new Error(NOT_FOUND);
    return new Error(err.message || fallback);
  }
  if (err instanceof Error) return err;
  return new Error(fallback);
}

/** The API client the read runs as: the person, or the machine token. */
async function readerApi(): Promise<NyuchiApi> {
  return (await optionalPersonApi()) ?? asService();
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
const viewerAccess = viewerCircleAccess;

/** The signed-in person and their access, for a WRITE. Throws when the
 *  circle is hidden from them (the same message as a missing circle). */
const actingAccess = actingCircleAccess;

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * The circle as this viewer may see it, with their permission flags. `null`
 * when it does not exist, is inactive, or is hidden from them.
 */
export async function getCircle(
  circleId: string,
): Promise<CircleDetail | null> {
  try {
    const { signedIn, viewerPersonId, resolved } = await viewerAccess(circleId);
    return resolved ? mapCircle(resolved, signedIn, viewerPersonId) : null;
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

    if (circlesViaApi()) {
      // Readers see approved posts the API lets them read; authors also see
      // their own pending posts. The archive is the staff moderation queue
      // (pending and flagged): removed posts are never shown to readers.
      const api = await readerApi();
      const path = archived
        ? circlesPath.moderation(circleId, Math.min(Math.max(limit, 1), 100))
        : circlesPath.posts(circleId, Math.min(Math.max(limit, 1), 100));
      const docs = listOf<ApiPost>(await api.get(path));
      const byId = await hydrateViaApi(
        api,
        docs.map((d) => d.authorPersonId),
      );
      return docs.map((d) => mapApiPost(d, byId.get(d.authorPersonId) ?? null));
    }

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
    if (circlesViaApi()) {
      const api = await readerApi();
      const docs = listOf<ApiMembership>(
        await api.get(
          circlesPath.members(circleId, Math.min(Math.max(limit, 1), 200)),
        ),
      );
      const byId = await hydrateViaApi(
        api,
        docs.map((d) => d.memberPersonId),
      );
      return docs.map((d) => ({
        circle_id: d.circleId,
        person_id: d.memberPersonId,
        role: d.role,
        status: d.membershipStatus,
        joined_at: d.joinedAt ?? null,
        person: byId.get(d.memberPersonId) ?? null,
      }));
    }
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

  const { resolved, api } = await actingAccess(input.circleId);
  if (!resolved.permissions.canPost) {
    throw new Error(
      resolved.permissions.access === "member"
        ? "Only the circle's staff can post here."
        : "Join this circle to post.",
    );
  }

  if (api) {
    // The API sets the visibility (never public in a private or secret
    // circle) and the moderation status from `moderationPolicy.postApproval`.
    try {
      const doc = unwrap<ApiPost>(
        await api.post(circlesPath.posts(input.circleId), {
          article_body: text,
          post_type: "discussion",
        }),
        "post",
      );
      return mapApiPost(doc, null);
    } catch (err) {
      throw apiWriteError(err, "Your post couldn't be saved.");
    }
  }

  const person = await requireActingPerson("You must be signed in to do that.");
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
  const { resolved, api, personId } = await actingAccess(circleId);
  if (!resolved.permissions.canUseChat) {
    throw new Error("Join this circle to open its chat.");
  }

  if (api) {
    // Idempotent; the API seats the caller as a participant.
    try {
      const conversation = unwrap<{ _id?: string; id?: string }>(
        await api.post(circlesPath.conversation(circleId)),
        "conversation",
      );
      const id = conversation?._id ?? conversation?.id;
      if (!id) throw new Error("This circle's chat could not be opened.");
      return id;
    } catch (err) {
      throw apiWriteError(err, "This circle's chat could not be opened.");
    }
  }

  const person = { _id: personId as string };
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
  const { resolved, api } = await actingAccess(input.circleId);
  const { permissions } = resolved;

  if (permissions.access === "member" || permissions.access === "staff") {
    return "active";
  }
  const mode = permissions.join;
  if (mode === null) {
    throw new Error("You can't join this circle.");
  }
  if (mode === "requested") return "pending_approval";

  if (api) {
    // Public and broadcast join at once; private answers a request; an
    // invitee joining accepts the invitation.
    try {
      const membership = unwrap<ApiMembership>(
        await api.post(circlesPath.join(input.circleId)),
        "membership",
      );
      return membership?.membershipStatus === "pending_approval"
        ? "pending_approval"
        : "active";
    } catch (err) {
      throw apiWriteError(err, "You couldn't join this circle.");
    }
  }

  const person = await requireActingPerson("You must be signed in to do that.");
  const memberships = await circleMembershipsCollection();
  const existing = await memberships.findOne({
    circleId: input.circleId,
    memberPersonId: person._id,
  });

  const nextStatus: JoinCircleResult =
    mode === "request" ? "pending_approval" : "active";
  const now = new Date();

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
  /** The post's circle. Required on the API path (the reaction route is
   *  nested under the circle); the MongoDB path reads it off the post. */
  circleId?: string;
}): Promise<"added" | "removed"> {
  if (circlesViaApi()) return togglePostReactionViaApi(input);

  const person = await requireActingPerson("You must be signed in to do that.");
  const posts = await circlePostsCollection();
  const post = await posts.findOne({ _id: input.postId });
  const notFound = POST_NOT_FOUND;
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

/**
 * The API path of {@link togglePostReaction}: `PUT`/`DELETE` the caller's
 * `like` (one `circles.postReactions` row per person per post; the API keeps
 * `reactionCount`). The post is read first, as the person, so a post they
 * can't read is "not found" and their current reaction decides the toggle.
 */
async function togglePostReactionViaApi(input: {
  postId: string;
  circleId?: string;
}): Promise<"added" | "removed"> {
  if (!input.circleId) throw new Error(POST_NOT_FOUND);
  const api = await personApi();
  const resolved = await loadCircleAccessViaApi(api, input.circleId);
  if (!resolved?.permissions.canReadPosts) throw new Error(POST_NOT_FOUND);

  let post: ApiPost;
  try {
    post = unwrap<ApiPost>(
      await api.get(circlesPath.post(input.circleId, input.postId)),
      "post",
    );
  } catch (err) {
    if (err instanceof NyuchiApiError && [403, 404].includes(err.status)) {
      throw new Error(POST_NOT_FOUND);
    }
    throw apiWriteError(err, "Couldn't save your reaction.");
  }
  if (!post?._id || post.moderationStatus === "removed") {
    throw new Error(POST_NOT_FOUND);
  }
  if (!resolved.permissions.canReact) {
    throw new Error("Join this circle to react.");
  }

  try {
    if (viewerReactionOf(post)) {
      await api.delete(circlesPath.reaction(input.circleId, input.postId));
      return "removed";
    }
    await api.put(circlesPath.reaction(input.circleId, input.postId), {
      key: "like",
    });
    return "added";
  } catch (err) {
    throw apiWriteError(err, "Couldn't save your reaction.");
  }
}
