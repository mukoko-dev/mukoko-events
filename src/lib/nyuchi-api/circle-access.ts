import "server-only";

/**
 * Circle access on the Nyuchi API path (server-only).
 *
 * `GET /v1/circles/{id}`, called as the viewer, returns the circle with the
 * caller's own membership (`viewerMembership: {role, membershipStatus}`). The
 * API already answers 404 for an inactive circle and for a secret circle to
 * anyone but its members and invitees. The answer then runs through the same
 * pure policy as the MongoDB path (`@/lib/circle-access`), so the UI flags and
 * every action decide exactly as before.
 */

import { circlePermissions, type CirclePermissions } from "@/lib/circle-access";
import { NyuchiApiError, type NyuchiApi } from "./client";
import { circlesPath, unwrap, type ApiCircle } from "./circles";

export interface ApiCircleAccess {
  circle: ApiCircle;
  membership: { role: string; membershipStatus: string } | null;
  permissions: CirclePermissions;
}

/** True for the answers that mean "no such circle for you". */
export function isNotFound(err: unknown): boolean {
  return (
    err instanceof NyuchiApiError && (err.status === 404 || err.status === 403)
  );
}

/**
 * The viewer's access to one circle, read through `api` (the person's token,
 * or the machine token for an anonymous visitor). `null` when the API answers
 * 404 (missing, inactive, or secret to this viewer) or the policy hides it.
 */
export async function loadCircleAccessViaApi(
  api: NyuchiApi,
  circleId: string,
): Promise<ApiCircleAccess | null> {
  if (!circleId) return null;
  let circle: ApiCircle;
  try {
    circle = unwrap<ApiCircle>(
      await api.get(circlesPath.circle(circleId)),
      "circle",
    );
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  if (!circle?._id) return null;
  const vm = circle.viewerMembership;
  const membership =
    vm && typeof vm.role === "string" && typeof vm.membershipStatus === "string"
      ? { role: vm.role, membershipStatus: vm.membershipStatus }
      : null;
  const permissions = circlePermissions(
    { circleType: circle.circleType, isActive: circle.isActive },
    membership,
  );
  if (!permissions.canSeeCircle) return null;
  return { circle, membership, permissions };
}
