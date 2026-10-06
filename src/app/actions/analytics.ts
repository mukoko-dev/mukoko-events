"use server";

/**
 * Event analytics for the organiser Insights tab, from the Nyuchi API
 * (`/v1/analytics/events/{id}` + `/v1/insights/events/{id}`), as the
 * signed-in person. The API enforces the host check (the event's organiser,
 * or an admin/owner of its host entity); the manage page has already gated
 * the caller as a host, so a 403 here is a missing `analytics` scope on the
 * key or token, not "not your event".
 *
 * Never a crash and never fake zeros: when the API is not configured, the
 * caller has no API session (the local dev bypass), or the call fails or is
 * refused, the answer is `unavailable` and the tab says "not available yet".
 */

import { isNyuchiApiConfigured, NyuchiApiError } from "@/lib/nyuchi-api/client";
import { personApi } from "@/lib/nyuchi-api/session";
import {
  clampDays,
  getEventAnalytics,
  getEventInsights,
  type EventAnalytics,
  type Insights,
} from "@/lib/nyuchi-api/analytics";

export type EventAnalyticsResult =
  | { status: "ok"; analytics: EventAnalytics; insights: Insights | null }
  | { status: "unavailable" };

export async function getEventAnalyticsAction(
  eventId: string,
  days = 30,
): Promise<EventAnalyticsResult> {
  if (!isNyuchiApiConfigured()) return { status: "unavailable" };
  try {
    const api = await personApi();
    const [analytics, insights] = await Promise.all([
      getEventAnalytics(api, eventId, clampDays(days)),
      // Insights are a nicety: their failure never hides the figures.
      getEventInsights(api, eventId).catch(() => null),
    ]);
    return { status: "ok", analytics, insights };
  } catch (err) {
    console.error(
      `[mukoko] event analytics unavailable (${err instanceof NyuchiApiError ? err.status : err instanceof Error ? err.name : "error"})`,
    );
    return { status: "unavailable" };
  }
}
