import "server-only";

/**
 * Analytics and insights on the Nyuchi API (nyuchi/api-gateway#268): the
 * shapes it returns and the calls Mukoko Events makes.
 *
 * - `GET /v1/analytics/events/{id}?days=` and `GET /v1/insights/events/{id}`:
 *   the event's host only, so they go out as the signed-in person
 *   (`asPerson`), exactly as circles do.
 * - `GET /v1/analytics/community?locality=`: public, every figure k-suppressed.
 * - `POST /v1/analytics/views`: records a view. No person is stored.
 *
 * Privacy: aggregates only. A breakdown cell or public count below k (5) comes
 * back as `{ value: null, suppressed: true }` and is shown as "fewer than 5",
 * never as 0. A response with `available: false` means the platform has no
 * figures for it yet, shown as "not available yet".
 */

import { seg, type NyuchiApi } from "./client";

/** One figure: `value` is null when it is suppressed (below k) or unknown. */
export interface Metric {
  value: number | null;
  suppressed: boolean;
}

export interface AnalyticsWindow {
  from: string;
  to: string;
  days: number;
}

/** Carried by every analytics response. */
export interface AnalyticsCommon {
  source: "mongo" | "doris";
  available: boolean;
  window: AnalyticsWindow;
  k: number;
}

export interface Breakdown {
  available: boolean;
  items: { name: string; views: Metric }[];
}

export interface EventAnalytics extends AnalyticsCommon {
  subject: { type: "Event"; id: string };
  /** Lifetime totals, exact for the host; `days` shapes only `series` and breakdowns. */
  totals: {
    views: Metric;
    rsvps: Metric;
    checkins: Metric;
    checkin_rate: number | null;
  };
  series: { date: string; views: Metric; rsvps: Metric; checkins: Metric }[];
  breakdowns: { localities: Breakdown; sources: Breakdown };
  /**
   * Fields the answering engine has no source for (e.g. `series.views` on
   * the MongoDB engine). Their cells are `{ value: null, suppressed: false }`:
   * no data, which is not the same as "fewer than 5".
   */
  unavailable?: string[];
}

export interface InsightItem {
  kind: string;
  title: string;
  text: string;
  metric?: Metric;
  trend?: "up" | "down" | "flat";
}

export interface Insights {
  items: InsightItem[];
  source: "mongo" | "doris";
  available: boolean;
}

export interface CommunityAnalytics extends AnalyticsCommon {
  locality: string | null;
  totals: { events: Metric; attendees: Metric; active_hosts: Metric };
  trending_categories: {
    name: string;
    events: Metric;
    change: number | null;
  }[];
  popular_venues: { name: string; events: Metric }[];
  peak_time: { day: string; hour: number } | null;
}

/** The windows the Insights tab offers; the API takes 1..90. */
export const ANALYTICS_WINDOWS = [7, 30, 90] as const;
export type AnalyticsDays = (typeof ANALYTICS_WINDOWS)[number];

export function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 30;
  return Math.min(90, Math.max(1, Math.round(days)));
}

export function getEventAnalytics(
  api: NyuchiApi,
  eventId: string,
  days = 30,
): Promise<EventAnalytics> {
  return api.get<EventAnalytics>(
    `/v1/analytics/events/${seg(eventId)}?days=${clampDays(days)}`,
  );
}

export function getEventInsights(
  api: NyuchiApi,
  eventId: string,
): Promise<Insights> {
  return api.get<Insights>(`/v1/insights/events/${seg(eventId)}`);
}

export function getCommunityAnalytics(
  api: NyuchiApi,
  locality?: string,
): Promise<CommunityAnalytics> {
  const place = locality?.trim();
  const query = place ? `?locality=${encodeURIComponent(place)}` : "";
  return api.get<CommunityAnalytics>(`/v1/analytics/community${query}`);
}

export interface ViewRecord {
  subject_type: "Event" | "Circle";
  subject_id: string;
  /** Daily pseudonymous key: repeats collapse to one view per visitor per day. */
  visitor_key: string;
  referrer_host?: string;
  locality?: string;
}

export async function recordView(
  api: NyuchiApi,
  view: ViewRecord,
): Promise<void> {
  await api.post("/v1/analytics/views", view);
}

/** A metric's value when it is a real figure, else null (suppressed or missing). */
export function metricValue(metric: Metric | null | undefined): number | null {
  if (!metric || metric.suppressed) return null;
  return typeof metric.value === "number" && Number.isFinite(metric.value)
    ? metric.value
    : null;
}

/**
 * Only the host of a referrer URL, lower-cased, and never our own host (an
 * in-site navigation is not a traffic source). Anything else is dropped.
 */
export function referrerHost(
  referrer: string | null | undefined,
  ownHost?: string | null,
): string | undefined {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const host = url.hostname.toLowerCase();
    if (!host || host.length > 253) return undefined;
    if (ownHost && host === ownHost.toLowerCase()) return undefined;
    return host;
  } catch {
    return undefined;
  }
}
