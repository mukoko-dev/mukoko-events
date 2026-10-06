"use client";

import { useEffect } from "react";
import { trackEventViewAction } from "@/app/actions/discovery";

/**
 * `document.referrer` belongs to the first full page load and doesn't change
 * on in-app navigation, so it is sent with the first recorded view only.
 * Later views in the same visit came from within the site: no referrer.
 */
let referrerUsed = false;

/** Test hook: start a fresh page load. */
export function __resetReferrer(): void {
  referrerUsed = false;
}

/**
 * Records one view of the event page (POST /v1/analytics/views through the
 * server action). Rendered once per page: the sidebar's registration panel
 * and the mobile RSVP bar both used to record a view, so every visit counted
 * twice. Best-effort and invisible; only the referrer's host is sent, and
 * the action drops our own host (in-site navigation is not a source).
 */
export function EventViewTracker({ eventId }: { eventId: string }) {
  useEffect(() => {
    const referrer = referrerUsed ? undefined : document.referrer || undefined;
    referrerUsed = true;
    void trackEventViewAction(eventId, referrer).catch(() => {});
  }, [eventId]);
  return null;
}
