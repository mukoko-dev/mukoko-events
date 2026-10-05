/**
 * Server-side circle access resolution (server-only).
 *
 * Loads a circle and the viewer's membership row and runs the pure policy in
 * `@/lib/circle-access`. Every circle read and write — the `/circles/[id]`
 * page, the circle server actions, the circle-paired Campfire chat, and the
 * provenance links on calendar and event pages — decides through here, so
 * the rules live in one place and are enforced on the server, not the UI.
 */

import "server-only";
import { circleMembershipsCollection, circlesCollection } from "./databases";
import { circlePermissions, type CirclePermissions } from "@/lib/circle-access";
import type { CircleDoc, CircleMembershipDoc } from "./types";

export interface ResolvedCircleAccess {
  circle: CircleDoc;
  membership: CircleMembershipDoc | null;
  permissions: CirclePermissions;
}

/**
 * Resolve the viewer's access to one circle. Returns `null` when the circle
 * does not exist, is inactive, or is hidden from this viewer (a secret circle
 * to a non-member) — callers answer all three the same way (404), so the
 * existence of a secret circle never leaks.
 */
export async function loadCircleAccess(
  circleId: string,
  viewerPersonId: string | null,
): Promise<ResolvedCircleAccess | null> {
  if (!circleId) return null;
  const circles = await circlesCollection();
  const circle = await circles.findOne({ _id: circleId });
  if (!circle) return null;

  let membership: CircleMembershipDoc | null = null;
  if (viewerPersonId) {
    const memberships = await circleMembershipsCollection();
    membership = await memberships.findOne({
      circleId,
      memberPersonId: viewerPersonId,
    });
  }

  const permissions = circlePermissions(circle, membership);
  if (!permissions.canSeeCircle) return null;
  return { circle, membership, permissions };
}

/**
 * Of `circleIds`, the ones a calendar or event page may link to for this
 * viewer: public and broadcast circles, plus private and secret circles the
 * viewer is an active member of. Fails closed (empty set) on any error.
 */
export async function visibleCircleLinkIds(
  circleIds: readonly string[],
  viewerPersonId: string | null,
): Promise<Set<string>> {
  const ids = [...new Set(circleIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  try {
    const circles = await circlesCollection();
    const docs = await circles
      .find({ _id: { $in: ids } })
      .project<Pick<CircleDoc, "_id" | "circleType" | "isActive">>({
        circleType: 1,
        isActive: 1,
      })
      .toArray();

    const memberships = new Map<string, CircleMembershipDoc>();
    if (viewerPersonId) {
      const col = await circleMembershipsCollection();
      const rows = await col
        .find({ circleId: { $in: ids }, memberPersonId: viewerPersonId })
        .toArray();
      for (const row of rows) memberships.set(row.circleId, row);
    }

    return new Set(
      docs
        .filter(
          (d) =>
            circlePermissions(d, memberships.get(d._id) ?? null).canBeLinked,
        )
        .map((d) => d._id),
    );
  } catch (err) {
    console.warn("[mukoko] visibleCircleLinkIds failed:", err);
    return new Set();
  }
}
