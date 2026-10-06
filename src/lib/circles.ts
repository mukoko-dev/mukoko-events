/**
 * Circle reads for browse surfaces, provenance links and the calendar picker
 * (server-only), on whichever backend is switched on: the Nyuchi API's
 * `/v1/circles` when `NYUCHI_API_CLIENT_ID`/`_SECRET` are set
 * (mukoko-dev/mukoko-events#154), else the server-side MongoDB reads in
 * `@/lib/mongo/circles`.
 *
 * Browse surfaces list public and broadcast circles only, on both paths:
 * private and secret circles are never listed (owner rule, 2026-10-04).
 */

import "server-only";
import { asService } from "@/lib/nyuchi-api/client";
import { personApi } from "@/lib/nyuchi-api/session";
import { circlesPath, listOf, type ApiCircle } from "@/lib/nyuchi-api/circles";
import {
  isNotFound,
  loadCircleAccessViaApi,
} from "@/lib/nyuchi-api/circle-access";
import { isPubliclyListableCircle } from "@/lib/circle-visibility";
import { circlesViaApi, viewerCircleAccess } from "@/lib/viewer-circle-access";
import * as mongo from "@/lib/mongo/circles";

/** `GET /v1/circles/featured` accepts at most 24. */
const FEATURED_FETCH_LIMIT = 24;

export type { FeaturedCircle, OwnedCircle } from "@/lib/mongo/circles";
import type { FeaturedCircle, OwnedCircle } from "@/lib/mongo/circles";

/**
 * Tiny id→name resolve for provenance links (a calendar's "from <circle>"
 * line). Named only when the viewer may follow the link: public and broadcast
 * circles for everyone, private and secret circles for their active members.
 *
 * On the API path the read acts as the viewer (their exchanged token), never
 * as Mukoko Events itself, so a private circle is named to its members only.
 * `viewerPersonId` serves the MongoDB path.
 */
export async function getCircleSummary(
  circleId: string,
  viewerPersonId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!circlesViaApi()) return mongo.getCircleSummary(circleId, viewerPersonId);
  const { resolved } = await viewerCircleAccess(circleId);
  if (!resolved || !resolved.permissions.canBeLinked) return null;
  return { id: resolved.circle._id, name: resolved.circle.name };
}

/**
 * Circles the signed-in person owns (a calendar may only attach to a circle
 * its creator owns). Secret circles included: it is the person's own list.
 */
export async function listCirclesByOwner(
  ownerPersonId: string,
): Promise<OwnedCircle[]> {
  if (!circlesViaApi()) return mongo.listCirclesByOwner(ownerPersonId);
  const api = await personApi();
  const docs = listOf<ApiCircle>(
    await api.get(circlesPath.list({ mine: true, limit: 100 })),
  );
  return docs
    .filter((d) => d.ownerPersonId === ownerPersonId && d.isActive !== false)
    .map((d) => ({ id: d._id, name: d.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the signed-in person owns this active circle. */
export async function isCircleOwnedBy(
  circleId: string,
  personId: string,
): Promise<boolean> {
  if (!circlesViaApi()) return mongo.isCircleOwnedBy(circleId, personId);
  try {
    const resolved = await loadCircleAccessViaApi(await personApi(), circleId);
    return (
      resolved !== null &&
      resolved.circle.ownerPersonId === personId &&
      resolved.membership?.role === "owner" &&
      resolved.membership.membershipStatus === "active"
    );
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** The most active publicly listable circles (by members, then posts). */
export async function listFeaturedCircles(
  limit = 6,
): Promise<FeaturedCircle[]> {
  if (!circlesViaApi()) return mongo.listFeaturedCircles(limit);
  // `featured` returns every discoverable type, private included, and
  // applies its limit before this filter. Ask for the API's maximum and trim
  // here, so private circles at the top don't crowd public ones out.
  const docs = listOf<ApiCircle>(
    await asService().get(
      circlesPath.featured(Math.max(limit, FEATURED_FETCH_LIMIT)),
    ),
  );
  // This surface lists public and broadcast only (fail closed on anything else).
  const listable = docs.flatMap((d) => {
    const circleType: unknown = d.circleType;
    if (d.isActive === false || !isPubliclyListableCircle(circleType))
      return [];
    return [
      {
        id: d._id,
        name: d.name,
        slug: d.slug ?? null,
        description: d.description ?? null,
        circleType,
        memberCount: d.memberCount ?? 0,
        postCount: d.postCount ?? 0,
      },
    ];
  });
  return listable.slice(0, limit);
}
