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
import { trustedClientIp } from "@/lib/client-address";
import { visitorKey } from "@/lib/visitor-key";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { isDevBypass } from "@/lib/auth/dev";
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

/** The signed-in person's WorkOS id, or null (signed out, dev bypass, no AuthKit). */
async function signedInId(): Promise<string | null> {
  if (isDevBypass()) return null;
  try {
    const { user } = await withAuth();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a page view for an event: `POST /v1/analytics/views` on the Nyuchi
 * API (nyuchi/api-gateway#268). Idempotent, not throttled: each view carries
 * a daily pseudonymous `visitor_key` (`@/lib/visitor-key`), and the API
 * counts one view per visitor per event per day, so a loop can't inflate the
 * count and there is no in-app state to fill or lock out.
 *
 * No person, address or city is sent: only the event, the visitor key and
 * the referrer's host (never our own). Best-effort and fail-closed: no API,
 * no `VIEW_VISITOR_KEY_SECRET`, or no trusted identity (`@/lib/client-address`)
 * means nothing is recorded, and nothing breaks.
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
    const personId = await signedInId();
    let key: string | null;
    if (personId) {
      key = visitorKey({ kind: "person", personId });
    } else {
      const ip = trustedClientIp(h);
      key = ip
        ? visitorKey({ kind: "anonymous", ip, userAgent: h.get("user-agent") })
        : null;
    }
    if (!key) return;
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
      visitor_key: key,
      ...(source ? { referrer_host: source } : {}),
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
