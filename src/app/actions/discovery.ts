"use server";

/**
 * Discovery read server actions (Vercel server runtime → MongoDB).
 *
 * These let client components read events / categories / cities straight
 * from MongoDB through the server, replacing the worker-era
 * `@/lib/api` fetches to `/api/*`. Return shapes match the old `@/lib/api`
 * helpers so call sites swap the import and `await` the action — no UI change.
 *
 * Server Components should prefer the underlying `@/lib/mongo/*` reads directly
 * (true SSR, no action round-trip); these actions exist for interactive client
 * components that fetch after mount. Community stats and view recording go
 * through the Nyuchi API's analytics routes instead (nyuchi/api-gateway#268).
 */

import {
  listEvents,
  getEventByIdOrSlug,
  getTrendingEvents,
} from "@/lib/mongo/events";
import { headers } from "next/headers";
import { listCategories, listCities } from "@/lib/mongo/lookups";
import { loadCommunityStats } from "@/lib/community-stats";
import { asService, isNyuchiApiConfigured } from "@/lib/nyuchi-api/client";
import { recordView, referrerHost } from "@/lib/nyuchi-api/analytics";
import type {
  Category,
  CommunityStats,
  Event,
  EventsResponse,
} from "@/lib/api";

export async function getEventsAction(params?: {
  city?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<EventsResponse> {
  const { events, total, limit, offset } = await listEvents({
    city: params?.city,
    category: params?.category,
    limit: params?.limit,
    offset: params?.offset,
  });
  return { events, pagination: { limit, offset, total } };
}

export async function findEventAction(idOrSlug: string): Promise<Event | null> {
  return getEventByIdOrSlug(idOrSlug);
}

/**
 * Record a page view for an event: `POST /v1/analytics/views` on the Nyuchi
 * API (nyuchi/api-gateway#268). No person is sent or stored: only the event,
 * the referrer's host (never our own) and the viewer's city as Vercel's edge
 * reports it. Best-effort: when the API is not configured or the call fails,
 * nothing is recorded and nothing breaks.
 */
export async function trackEventViewAction(
  eventId: string,
  referrer?: string,
): Promise<void> {
  if (!isNyuchiApiConfigured()) return;
  if (typeof eventId !== "string" || !eventId || eventId.length > 200) return;
  try {
    const h = await headers();
    const ownHost = (h.get("x-forwarded-host") ?? h.get("host") ?? "")
      .split(":")[0]
      .trim();
    const source = referrerHost(referrer, ownHost || null);
    let locality: string | undefined;
    const city = h.get("x-vercel-ip-city");
    if (city) {
      try {
        locality = decodeURIComponent(city).slice(0, 100) || undefined;
      } catch {
        locality = undefined;
      }
    }
    await recordView(asService(), {
      subject_type: "Event",
      subject_id: eventId,
      ...(source ? { referrer_host: source } : {}),
      ...(locality ? { locality } : {}),
    });
  } catch {
    // Analytics never break the page.
  }
}

export async function getTrendingEventsAction(params?: {
  limit?: number;
}): Promise<Event[]> {
  return getTrendingEvents(params?.limit ?? 10);
}

export async function getCategoriesAction(): Promise<Category[]> {
  return listCategories();
}

export async function getCitiesAction(): Promise<
  { addressLocality: string; addressCountry: string }[]
> {
  return listCities();
}

/** Community stats from the Nyuchi API; `available: false` when it can't answer. */
export async function getCommunityStatsAction(
  city?: string,
): Promise<CommunityStats> {
  return loadCommunityStats(city);
}
