import "server-only";

/**
 * The viewer's access to circles, on whichever backend is switched on.
 *
 * - Nyuchi API configured (`isNyuchiApiConfigured()`): the circle and the
 *   viewer's membership come from `GET /v1/circles/{id}`, called as the
 *   signed-in person (their exchanged token), or with Mukoko Events' machine
 *   token for an anonymous visitor.
 * - Not configured: the server-side MongoDB loader (`@/lib/mongo/circle-access`).
 *
 * Either way the answer runs through the one policy, `@/lib/circle-access`,
 * so pages, actions, the circle chat and provenance links decide the same.
 */

import {
  isNyuchiApiConfigured,
  asService,
  type NyuchiApi,
} from "@/lib/nyuchi-api/client";
import { optionalPersonApi, personApi } from "@/lib/nyuchi-api/session";
import { loadCircleAccessViaApi } from "@/lib/nyuchi-api/circle-access";
import {
  loadCircleAccess,
  visibleCircleLinkIds as visibleCircleLinkIdsMongo,
} from "@/lib/mongo/circle-access";
import {
  requireActingPerson,
  resolveViewerPersonId,
} from "@/lib/auth/current-person";
import type { CirclePermissions } from "@/lib/circle-access";

/** The circle fields every circle surface reads, on either backend. */
export interface CircleRecord {
  _id: string;
  name: string;
  slug?: string;
  description?: string | null;
  circleType?: unknown;
  ownerPersonId: string;
  memberCount?: number | null;
  postCount?: number | null;
  primaryEventId?: string | null;
  isActive?: boolean | null;
}

export interface ViewerMembership {
  role: string;
  membershipStatus: string;
}

export interface ResolvedCircleAccess {
  circle: CircleRecord;
  membership: ViewerMembership | null;
  permissions: CirclePermissions;
}

/** One message for every "no such circle / not yours to see" answer. */
export const CIRCLE_NOT_FOUND = "This circle could not be found.";

/** True when circles are read and written through the Nyuchi API. */
export function circlesViaApi(): boolean {
  return isNyuchiApiConfigured();
}

/** The API as the viewer: their person token, or the machine token. */
async function viewerApi(): Promise<{ api: NyuchiApi; signedIn: boolean }> {
  const person = await optionalPersonApi();
  return person
    ? { api: person, signedIn: true }
    : { api: asService(), signedIn: false };
}

export interface ViewerCircleAccess {
  /** Whether a signed-in person is looking. */
  signedIn: boolean;
  /** The viewer's person id when known (MongoDB path only). */
  viewerPersonId: string | null;
  resolved: ResolvedCircleAccess | null;
}

/**
 * The viewer's access to one circle for a READ (anonymous allowed).
 * `resolved` is null when the circle is missing, inactive or hidden.
 */
export async function viewerCircleAccess(
  circleId: string,
): Promise<ViewerCircleAccess> {
  if (circlesViaApi()) {
    const { api, signedIn } = await viewerApi();
    const resolved = await loadCircleAccessViaApi(api, circleId);
    return { signedIn, viewerPersonId: null, resolved };
  }
  const viewerPersonId = await resolveViewerPersonId();
  const resolved = await loadCircleAccess(circleId, viewerPersonId);
  return { signedIn: viewerPersonId !== null, viewerPersonId, resolved };
}

/**
 * The signed-in person's access for a WRITE. Throws when signed out, and
 * throws {@link CIRCLE_NOT_FOUND} when the circle is hidden from them.
 * On the API path `api` is the person's client, for the write itself.
 */
export async function actingCircleAccess(circleId: string): Promise<{
  resolved: ResolvedCircleAccess;
  api: NyuchiApi | null;
  personId: string | null;
}> {
  if (circlesViaApi()) {
    const api = await personApi();
    const resolved = await loadCircleAccessViaApi(api, circleId);
    if (!resolved) throw new Error(CIRCLE_NOT_FOUND);
    return { resolved, api, personId: null };
  }
  const person = await requireActingPerson("You must be signed in to do that.");
  const resolved = await loadCircleAccess(circleId, person._id);
  if (!resolved) throw new Error(CIRCLE_NOT_FOUND);
  return { resolved, api: null, personId: person._id };
}

/**
 * Of `circleIds`, the ones a calendar or event page may link to for the
 * current viewer: public and broadcast circles, plus private and secret
 * circles they are an active member of. Fails closed (empty set) on error.
 */
export async function visibleCircleLinkIdsForViewer(
  circleIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(circleIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  if (!circlesViaApi()) {
    return visibleCircleLinkIdsMongo(ids, await resolveViewerPersonId());
  }
  try {
    const { api } = await viewerApi();
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await loadCircleAccessViaApi(api, id);
          return r?.permissions.canBeLinked ? id : null;
        } catch {
          return null;
        }
      }),
    );
    return new Set(results.filter((id): id is string => id !== null));
  } catch (err) {
    console.warn("[mukoko] visibleCircleLinkIdsForViewer failed:", err);
    return new Set();
  }
}

/**
 * Whether the person may use a circle's paired chat (active members only).
 * `personId` is the MongoDB person id, used on the MongoDB path; the API path
 * acts as the signed-in person from the session.
 */
export async function canUseCircleChatAs(
  circleId: string,
  personId: string | null,
): Promise<boolean> {
  if (!personId) return false;
  if (circlesViaApi()) {
    const api = await optionalPersonApi();
    if (!api) return false;
    const resolved = await loadCircleAccessViaApi(api, circleId);
    return resolved?.permissions.canUseChat === true;
  }
  const resolved = await loadCircleAccess(circleId, personId);
  return resolved?.permissions.canUseChat === true;
}
