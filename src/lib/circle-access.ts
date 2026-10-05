/**
 * Who may see and do what in a circle — the one access policy.
 *
 * Mirrors the rules the Nyuchi API enforces on `/v1/circles`
 * (nyuchi/api-gateway `docs/architecture/circles.md`, decided 2026-10-04):
 *
 * | circleType  | non-member                                   | member          |
 * | ----------- | -------------------------------------------- | --------------- |
 * | public      | the circle, public posts, events, calendars  | all content     |
 * | broadcast   | as public (only staff post)                  | all content     |
 * | private     | name, description, counts, request to join   | all content     |
 * | secret      | 404 (an invitee sees name + accept invite)   | all content     |
 *
 * An inactive circle is 404 to everyone. A missing or unknown `circleType`
 * is treated as `secret` — the policy fails closed.
 *
 * Pure and dependency-free: the server read layer, the server actions and
 * the page all call it, and the client only ever receives its *result*
 * (permission flags), never the inputs it could tamper with. Draft #156
 * (circles through the Nyuchi API) reuses it for the same decisions.
 */

export type CircleType = "public" | "private" | "secret" | "broadcast";

export type CircleRole = "owner" | "admin" | "moderator" | "member" | "guest";

export type CircleMembershipStatus =
  | "active"
  | "pending_approval"
  | "invited"
  | "banned"
  | "left"
  | "removed";

export type CirclePostVisibility =
  | "public"
  | "circle_members"
  | "circle_admins_only";

/**
 * How much of a circle the viewer may see:
 *
 * - `hidden`  — 404. The circle's existence is not confirmed.
 * - `preview` — name, description and counts only (a private circle to a
 *   non-member, or a secret circle to an invitee).
 * - `reader`  — a public or broadcast circle to a non-member (or anonymous
 *   visitor): public posts, events and calendars.
 * - `member`  — an active member.
 * - `staff`   — an active owner, admin or moderator.
 */
export type CircleAccessLevel =
  | "hidden"
  | "preview"
  | "reader"
  | "member"
  | "staff";

/** What the viewer can do next to become part of the circle. */
export type CircleJoinMode =
  | "join" // public: join at once
  | "follow" // broadcast: join at once
  | "request" // private: ask; a moderator approves
  | "requested" // private: request already pending
  | "accept_invite" // secret (or any type): an invitation is waiting
  | null;

/** The minimum circle fields the policy reads. */
export interface CircleAccessSubject {
  circleType: unknown;
  isActive?: boolean | null;
}

/** The viewer's membership row for this circle, if any. */
export interface CircleAccessMembership {
  role: string;
  membershipStatus: string;
}

/** Everything the UI and the actions need to decide, as plain flags. */
export interface CirclePermissions {
  access: CircleAccessLevel;
  /** Name, description and counts. */
  canSeeCircle: boolean;
  /** The post stream (with {@link readablePostVisibilities}). */
  canReadPosts: boolean;
  /** Which post `visibility` values the viewer may read. */
  readablePostVisibilities: CirclePostVisibility[];
  /** Events and calendars streaming through the circle. */
  canSeeEvents: boolean;
  /** The member roster (names). Members only, for every type. */
  canSeeMembers: boolean;
  canPost: boolean;
  canReact: boolean;
  /** The circle's paired Campfire group chat (read and write). */
  canUseChat: boolean;
  /** Removed posts — the moderation archive. Circle staff only. */
  canSeeArchive: boolean;
  /** Provenance links from calendars and events may point here. */
  canBeLinked: boolean;
  join: CircleJoinMode;
}

const KNOWN_TYPES: readonly CircleType[] = [
  "public",
  "private",
  "secret",
  "broadcast",
];

const STAFF_ROLES: readonly string[] = ["owner", "admin", "moderator"];

/** Normalise a stored type; anything unknown is treated as `secret`. */
export function normaliseCircleType(circleType: unknown): CircleType {
  return typeof circleType === "string" &&
    (KNOWN_TYPES as readonly string[]).includes(circleType)
    ? (circleType as CircleType)
    : "secret";
}

export function isCircleStaffRole(role: unknown): boolean {
  return typeof role === "string" && STAFF_ROLES.includes(role);
}

/** Resolve the viewer's access level for one circle. */
export function resolveCircleAccess(
  circle: CircleAccessSubject | null | undefined,
  membership: CircleAccessMembership | null | undefined,
): CircleAccessLevel {
  if (!circle || circle.isActive === false) return "hidden";
  const type = normaliseCircleType(circle.circleType);
  const status = membership?.membershipStatus ?? null;

  if (status === "active") {
    return isCircleStaffRole(membership?.role) ? "staff" : "member";
  }

  switch (type) {
    case "public":
    case "broadcast":
      // Anyone (banned people included) can read what is public anyway.
      return "reader";
    case "private":
      return "preview";
    case "secret":
      // Only an invitee learns a secret circle exists.
      return status === "invited" ? "preview" : "hidden";
  }
}

/** The post visibilities a given access level may read. */
export function readablePostVisibilities(
  access: CircleAccessLevel,
): CirclePostVisibility[] {
  switch (access) {
    case "staff":
      return ["public", "circle_members", "circle_admins_only"];
    case "member":
      return ["public", "circle_members"];
    case "reader":
      return ["public"];
    default:
      return [];
  }
}

function joinMode(
  type: CircleType,
  access: CircleAccessLevel,
  status: string | null,
): CircleJoinMode {
  if (access === "hidden" || access === "member" || access === "staff") {
    return null;
  }
  if (status === "banned") return null;
  if (status === "invited") return "accept_invite";
  switch (type) {
    case "public":
      return "join";
    case "broadcast":
      return "follow";
    case "private":
      return status === "pending_approval" ? "requested" : "request";
    case "secret":
      return null;
  }
}

/** Resolve every permission flag for the viewer on one circle. */
export function circlePermissions(
  circle: CircleAccessSubject | null | undefined,
  membership: CircleAccessMembership | null | undefined,
): CirclePermissions {
  const access = resolveCircleAccess(circle, membership);
  const type = normaliseCircleType(circle?.circleType);
  const isMember = access === "member" || access === "staff";
  const canRead = access === "reader" || isMember;

  return {
    access,
    canSeeCircle: access !== "hidden",
    canReadPosts: canRead,
    readablePostVisibilities: readablePostVisibilities(access),
    canSeeEvents: canRead,
    canSeeMembers: isMember,
    // Broadcast circles: only staff speak.
    canPost: type === "broadcast" ? access === "staff" : isMember,
    canReact: isMember,
    canUseChat: isMember,
    canSeeArchive: access === "staff",
    // A private circle's preview is not linked from calendars or events.
    canBeLinked: canRead,
    join: joinMode(type, access, membership?.membershipStatus ?? null),
  };
}

/**
 * The visibility a new post gets: `public` in public and broadcast circles,
 * `circle_members` in private and secret ones (a post there can never be
 * public).
 */
export function defaultPostVisibility(
  circleType: unknown,
): CirclePostVisibility {
  const type = normaliseCircleType(circleType);
  return type === "public" || type === "broadcast"
    ? "public"
    : "circle_members";
}

/** Whether the viewer may read one post with this `visibility`. */
export function canReadPostVisibility(
  permissions: Pick<CirclePermissions, "readablePostVisibilities">,
  visibility: unknown,
): boolean {
  return (
    typeof visibility === "string" &&
    (permissions.readablePostVisibilities as string[]).includes(visibility)
  );
}
