/**
 * Test fixtures for the Nyuchi API analytics contract
 * (nyuchi/api-gateway#268). Used by the tests only.
 */

import type {
  CommunityAnalytics,
  EventAnalytics,
  Insights,
  Metric,
} from "@/lib/nyuchi-api/analytics";

export const m = (value: number): Metric => ({ value, suppressed: false });
export const hidden: Metric = { value: null, suppressed: true };

const common = {
  source: "mongo" as const,
  available: true,
  window: { from: "2026-10-04", to: "2026-10-06", days: 3 },
  k: 5,
};

export function eventAnalyticsFixture(
  overrides: Partial<EventAnalytics> = {},
): EventAnalytics {
  return {
    ...common,
    subject: { type: "Event", id: "evt-1" },
    totals: {
      views: m(137),
      rsvps: m(6),
      checkins: m(2),
      checkin_rate: 0.33,
    },
    series: [
      { date: "2026-10-04", views: m(60), rsvps: m(5), checkins: hidden },
      { date: "2026-10-05", views: hidden, rsvps: hidden, checkins: hidden },
      { date: "2026-10-06", views: m(74), rsvps: hidden, checkins: hidden },
    ],
    breakdowns: {
      localities: {
        available: true,
        items: [
          { name: "Harare", views: m(90) },
          { name: "Bulawayo", views: hidden },
        ],
      },
      sources: { available: false, items: [] },
    },
    ...overrides,
  };
}

export function insightsFixture(overrides: Partial<Insights> = {}): Insights {
  return {
    items: [
      {
        kind: "views_trend",
        title: "Views are climbing",
        text: "Page views rose on the last day.",
        trend: "up",
      },
    ],
    source: "mongo",
    available: true,
    ...overrides,
  };
}

export function communityFixture(
  overrides: Partial<CommunityAnalytics> = {},
): CommunityAnalytics {
  return {
    ...common,
    locality: "Harare",
    totals: { events: m(42), attendees: m(1234), active_hosts: hidden },
    trending_categories: [
      { name: "Music", events: m(12), change: 25 },
      { name: "Tech", events: hidden, change: null },
    ],
    popular_venues: [{ name: "Harare Gardens", events: m(5) }],
    peak_time: { day: "Friday", hour: 18 },
    ...overrides,
  };
}
