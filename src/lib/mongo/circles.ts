/**
 * Public circle reads (server-only).
 *
 * A circle is a COMMUNITY — a schema.org OnlineCommunityGroup living in
 * `circles.circles` (members, posts feed, optional paired chat), not an event
 * calendar. These reads power public browse surfaces (/discover "featured
 * circles"): they list public and broadcast circles only — `private` and
 * `secret` circles never appear (owner rule, 2026-10-04), and
 * membership-gated content (posts, members) stays behind the session-scoped
 * server actions in `src/app/actions/circle*`.
 */

import "server-only";
import { circlesCollection } from "./databases";
import { loadCircleAccess } from "./circle-access";
import {
  LISTABLE_CIRCLE_TYPES,
  isPubliclyListableCircle,
  type ListableCircleType,
} from "@/lib/circle-visibility";

/** The small shape browse surfaces render for a circle. */
export interface FeaturedCircle {
  id: string;
  name: string;
  description: string | null;
  /**
   * Drives the join affordance: public → "Join", broadcast → "Follow".
   * Never `private` or `secret` — those are not listable.
   */
  circleType: ListableCircleType;
  memberCount: number;
  postCount: number;
}

/**
 * Tiny id→name resolve for provenance links (e.g. a calendar's
 * "from <circle>" line). Named only when the viewer may follow the link:
 * public and broadcast circles for everyone, private and secret circles for
 * their active members. A private circle's preview is not linked, and a
 * secret circle is never named to outsiders.
 */
export async function getCircleSummary(
  circleId: string,
  viewerPersonId: string | null,
): Promise<{ id: string; name: string } | null> {
  const resolved = await loadCircleAccess(circleId, viewerPersonId);
  if (!resolved || !resolved.permissions.canBeLinked) return null;
  return { id: resolved.circle._id, name: resolved.circle.name };
}

/** The small shape a "my circles" picker (e.g. calendar creation) renders. */
export interface OwnedCircle {
  id: string;
  name: string;
}

/**
 * Circles a person owns — used to restrict which circle a calendar can be
 * attached to at creation (a calendar may only attach to a circle its
 * creator owns). Includes secret circles since this is an owner-scoped read,
 * not a discovery surface.
 */
export async function listCirclesByOwner(
  ownerPersonId: string,
): Promise<OwnedCircle[]> {
  const col = await circlesCollection();
  const docs = await col
    .find({ ownerPersonId, isActive: true })
    .sort({ name: 1 })
    .project<{ _id: string; name: string }>({ name: 1 })
    .toArray();
  return docs.map((d) => ({ id: d._id, name: d.name }));
}

/**
 * The most active publicly listable circles (by members, then posts).
 * Private and secret circles are excluded at the query, and the mapper
 * re-checks each row so a circle with a missing or unknown type is dropped
 * too (fail closed).
 */
export async function listFeaturedCircles(
  limit = 6,
): Promise<FeaturedCircle[]> {
  const col = await circlesCollection();
  const docs = await col
    .find({
      isActive: true,
      circleType: { $in: [...LISTABLE_CIRCLE_TYPES] },
    })
    .sort({ memberCount: -1, postCount: -1 })
    .limit(limit)
    .toArray();

  return docs.flatMap((d) => {
    const circleType: unknown = d.circleType;
    if (!isPubliclyListableCircle(circleType)) return [];
    return [
      {
        id: d._id,
        name: d.name,
        description: d.description ?? null,
        circleType,
        memberCount: d.memberCount ?? 0,
        postCount: d.postCount ?? 0,
      },
    ];
  });
}
