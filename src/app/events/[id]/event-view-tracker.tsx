"use client";

import { useEffect } from "react";
import { trackEventViewAction } from "@/app/actions/discovery";

/**
 * `document.referrer` belongs to the first full page load and doesn't change
 * on in-app navigation, so it is sent with the first recorded view only.
 * Later views in the same visit came from within the site: no referrer.
 */
let referrerUsed = false;

/** One browser counts one view of an event per this long. */
export const REPEAT_VIEW_MS = 30 * 60_000;
const STORAGE_PREFIX = "mukoko-events:viewed:";

/** Test hook: start a fresh page load. */
export function __resetReferrer(): void {
  referrerUsed = false;
}

/** True when this browser already counted a view of the event recently. */
function seenRecently(eventId: string, now: number): boolean {
  try {
    const at = Number(sessionStorage.getItem(STORAGE_PREFIX + eventId));
    if (at && now - at < REPEAT_VIEW_MS) return true;
    sessionStorage.setItem(STORAGE_PREFIX + eventId, String(now));
  } catch {
    // Storage blocked (private mode): count the view.
  }
  return false;
}

/**
 * Records one view of the event page (POST /v1/analytics/views through the
 * server action). Rendered once per page: the sidebar's registration panel
 * and the mobile RSVP bar both used to record a view, so every visit counted
 * twice. A reload or a return within 30 minutes in the same tab session is
 * not a new view. Best-effort and invisible; only the referrer's host is
 * sent, and the action drops our own host.
 */
export function EventViewTracker({ eventId }: { eventId: string }) {
  useEffect(() => {
    if (seenRecently(eventId, Date.now())) return;
    const referrer = referrerUsed ? undefined : document.referrer || undefined;
    referrerUsed = true;
    void trackEventViewAction(eventId, referrer).catch(() => {});
  }, [eventId]);
  return null;
}
