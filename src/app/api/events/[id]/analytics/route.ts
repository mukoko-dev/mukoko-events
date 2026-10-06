/**
 * GET /api/events/:id/analytics — analytics for a hosted event.
 *
 * Bearer-authed HOST endpoint for the Mukoko Events MCP's `event_analytics`
 * tool. Auth is a WorkOS access token resolved to the acting person, who must
 * host the event (the same entity-centric gate as the registration/blast
 * endpoints). The figures come from the Nyuchi API
 * (`GET /v1/analytics/events/{id}`, nyuchi/api-gateway#268), called as that
 * person, and keep the `{ analytics }` shape the MCP reads.
 *
 * `uniqueViews` and `referrals` have no source on the platform, so they are
 * null, never a made-up 0. When the API is not configured, refuses, or does
 * not answer: 503 "Analytics are not available yet."
 */

import { NextResponse } from "next/server";
import { requireBearerEventHost, ActorError } from "@/lib/auth/mcp-host";
import {
  asPerson,
  isNyuchiApiConfigured,
  NyuchiApiError,
} from "@/lib/nyuchi-api/client";
import { getEventAnalytics, metricValue } from "@/lib/nyuchi-api/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_AVAILABLE = "Analytics are not available yet.";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = request.headers.get("Authorization");

  let ctx;
  try {
    ctx = await requireBearerEventHost(authorization, id);
  } catch (err) {
    if (err instanceof ActorError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  if (!isNyuchiApiConfigured())
    return NextResponse.json({ error: NOT_AVAILABLE }, { status: 503 });

  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const days = Number(new URL(request.url).searchParams.get("days") ?? 30);

  try {
    const eventId = ctx.event._id;
    const body = await getEventAnalytics(asPerson(token), eventId, days);
    if (!body.available)
      return NextResponse.json({ error: NOT_AVAILABLE }, { status: 503 });

    const views = metricValue(body.totals.views);
    const rsvps = metricValue(body.totals.rsvps);
    const checkins = metricValue(body.totals.checkins);
    const known = rsvps !== null && checkins !== null;
    return NextResponse.json({
      analytics: {
        eventId,
        views,
        uniqueViews: null,
        rsvps,
        checkins,
        referrals: null,
        remaining: known ? Math.max(0, rsvps - checkins) : null,
        // Whole percent, as before: checked in out of RSVPs.
        checkinRate: known
          ? rsvps > 0
            ? Math.round((checkins / rsvps) * 100)
            : 0
          : null,
        window: body.window,
        source: body.source,
      },
    });
  } catch (err) {
    // The caller is already verified as the host above, so an API refusal
    // (a missing `analytics` scope, say) is "not available yet", never
    // "you do not host this event".
    console.error(
      `[mukoko] GET /api/events/${id}/analytics: API unavailable (${err instanceof NyuchiApiError ? err.status : err instanceof Error ? err.name : "error"})`,
    );
    return NextResponse.json({ error: NOT_AVAILABLE }, { status: 503 });
  }
}
