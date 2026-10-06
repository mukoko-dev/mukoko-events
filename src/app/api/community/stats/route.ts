import { NextResponse } from "next/server";
import { loadCommunityStats } from "@/lib/community-stats";

/**
 * GET /api/community/stats — community stats from the Nyuchi API
 * (`GET /v1/analytics/community`), in the CommunityStats shape
 * src/lib/api.ts expects. Optional ?city= filter.
 *
 * Every count is k-suppressed: null means fewer than 5 when `available` is
 * true. With `available: false` (the API not configured or not answering)
 * every count is null: not available yet, never zeros.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const city = new URL(request.url).searchParams.get("city") ?? undefined;
  return NextResponse.json(await loadCommunityStats(city));
}
