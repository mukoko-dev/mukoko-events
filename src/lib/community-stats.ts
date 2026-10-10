import "server-only";

/**
 * Community stats for Mukoko Events, read from the Nyuchi API
 * (`GET /v1/analytics/community?locality=`, nyuchi/api-gateway#268) and
 * mapped onto the `CommunityStats` shape the app, signage and
 * `/api/community/stats` have always returned.
 *
 * When the API is not configured or the call fails, the answer is
 * `available: false` with every count null: "not available yet", never zeros.
 */

import type { CommunityStats } from "@/lib/api";
import { asService, isNyuchiApiConfigured } from "@/lib/nyuchi-api/client";
import {
  getCommunityAnalytics,
  metricValue,
  type CommunityAnalytics,
} from "@/lib/nyuchi-api/analytics";

export function unavailableCommunityStats(city?: string): CommunityStats {
  return {
    addressLocality: city,
    available: false,
    totalEvents: null,
    totalAttendees: null,
    activeHosts: null,
    trendingCategories: [],
    peakTime: null,
    popularVenues: [],
  };
}

function peakTime(peak: CommunityAnalytics["peak_time"]): string | null {
  if (!peak || typeof peak.day !== "string") return null;
  const hour = Number(peak.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return peak.day;
  return `${peak.day} ${String(hour).padStart(2, "0")}:00`;
}

export function toCommunityStats(
  body: CommunityAnalytics,
  city?: string,
): CommunityStats {
  if (!body.available) return unavailableCommunityStats(city);
  return {
    addressLocality: city ?? body.locality ?? undefined,
    available: true,
    totalEvents: metricValue(body.totals?.events),
    totalAttendees: metricValue(body.totals?.attendees),
    activeHosts: metricValue(body.totals?.active_hosts),
    trendingCategories: (body.trending_categories ?? []).map((c) => ({
      category: c.name,
      change: typeof c.change === "number" ? c.change : null,
      events: metricValue(c.events),
    })),
    peakTime: peakTime(body.peak_time),
    popularVenues: (body.popular_venues ?? []).map((v) => ({
      venue: v.name,
      events: metricValue(v.events),
    })),
  };
}

export async function loadCommunityStats(
  city?: string,
): Promise<CommunityStats> {
  const place = city?.trim() || undefined;
  if (!isNyuchiApiConfigured()) return unavailableCommunityStats(place);
  try {
    const body = await getCommunityAnalytics(asService(), place);
    return toCommunityStats(body, place);
  } catch (err) {
    console.error(
      `[mukoko] community stats unavailable (${err instanceof Error ? err.name : "error"})`,
    );
    return unavailableCommunityStats(place);
  }
}
