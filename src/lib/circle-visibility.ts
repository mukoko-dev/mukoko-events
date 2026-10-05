/**
 * Which circles may appear on a public surface, and where they link.
 *
 * Owner rule (2026-10-04): private circles are never listed publicly on any
 * discover page. Only `public` and `broadcast` circles are listable; `private`
 * and `secret` circles are not, and neither is a circle whose type is missing
 * or unrecognised — the check fails closed.
 *
 * No `server-only` guard: the same predicate runs in the Mongo read layer
 * (the query) and in the browse components (the render), so a private circle
 * can't reach the page even if one layer regresses.
 */

/** The circle types a public browse surface may list. */
export const LISTABLE_CIRCLE_TYPES = ["public", "broadcast"] as const;

export type ListableCircleType = (typeof LISTABLE_CIRCLE_TYPES)[number];

/**
 * True only for an explicitly public or broadcast circle. Anything else —
 * `private`, `secret`, `null`, `undefined`, a typo, a new type nobody has
 * classified yet — is treated as private.
 */
export function isPubliclyListableCircle(
  circleType: unknown,
): circleType is ListableCircleType {
  return (
    typeof circleType === "string" &&
    (LISTABLE_CIRCLE_TYPES as readonly string[]).includes(circleType)
  );
}

/**
 * A circle's public page. `/circles/[id]` is served without a session: anyone
 * can read the circle, its upcoming events and calendars there, and signed-in
 * visitors get the join/follow control.
 */
export function publicCircleHref(circleId: string): string {
  return `/circles/${encodeURIComponent(circleId)}`;
}
