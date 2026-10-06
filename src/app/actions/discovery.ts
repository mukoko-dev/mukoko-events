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
import { allowView } from "@/lib/view-throttle";
import { clientAddress } from "@/lib/client-address";
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
 * the referrer's host (never our own) and the viewer's city as the edge
 * reports it (Cloudflare's, when the request came through Cloudflare). Best-effort: when the API is not configured or the call fails,
 * nothing is recorded and nothing breaks. Server-side caps
 * (`@/lib/view-throttle`) guard our service token against a loop; repeat
 * views from one browser are de-duplicated in the browser. The API answers
 * 404 for an unknown or non-public event.
 */
const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function trackEventViewAction(
  eventId: string,
  referrer?: string,
): Promise<void> {
  if (!isNyuchiApiConfigured()) return;
  // Event ids are string UUIDs: anything else is not an event.
  if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) return;
  try {
    const h = await headers();
    const { address, city } = clientAddress(h);
    if (!allowView(address, eventId)) return;
    const ownHost = (h.get("x-forwarded-host") ?? h.get("host") ?? "")
      .split(":")[0]
      .trim();
    const source = referrerHost(
      typeof referrer === "string" ? referrer.slice(0, 2048) : undefined,
      ownHost || null,
    );
    await recordView(asService(), {
      subject_type: "Event",
      subject_id: eventId,
      ...(source ? { referrer_host: source } : {}),
      ...(city ? { locality: city } : {}),
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
