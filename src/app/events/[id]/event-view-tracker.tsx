"use client";

import { useEffect } from "react";
import { trackEventViewAction } from "@/app/actions/discovery";

/**
 * Records one view of the event page (POST /v1/analytics/views through the
 * server action). Rendered once per page: the sidebar's registration panel
 * and the mobile RSVP bar both used to record a view, so every visit counted
 * twice. Best-effort and invisible; only the referrer's host is sent, and
 * the action drops our own host (in-site navigation is not a source).
 */
export function EventViewTracker({ eventId }: { eventId: string }) {
  useEffect(() => {
    void trackEventViewAction(eventId, document.referrer || undefined).catch(
      () => {},
    );
  }, [eventId]);
  return null;
}
