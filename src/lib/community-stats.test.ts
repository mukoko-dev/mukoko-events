import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __resetTokenCache } from "@/lib/nyuchi-api/client";
import { loadCommunityStats, toCommunityStats } from "./community-stats";
import { communityFixture } from "@/__tests__/fixtures/nyuchi-analytics";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let community: () => Response = () => json(200, communityFixture());
const fetchMock = vi.fn(async (url: string) => {
  const path = new URL(String(url)).pathname;
  if (path === "/v1/auth/token")
    return json(200, { access_token: "svc-jwt", expires_in: 900 });
  if (path === "/v1/analytics/community") return community();
  return json(404, {});
});

beforeEach(() => {
  __resetTokenCache();
  fetchMock.mockClear();
  community = () => json(200, communityFixture());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NYUCHI_API_CLIENT_ID", "nyk_test");
  vi.stubEnv("NYUCHI_API_CLIENT_SECRET", "nys_test");
  vi.stubEnv("NYUCHI_API_URL", "https://api.example.test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("toCommunityStats", () => {
  it("maps the API onto the CommunityStats shape, suppressed counts as null", () => {
    expect(toCommunityStats(communityFixture(), "Harare")).toEqual({
      addressLocality: "Harare",
      available: true,
      totalEvents: 42,
      totalAttendees: 1234,
      activeHosts: null,
      trendingCategories: [
        { category: "Music", change: 25, events: 12 },
        { category: "Tech", change: null, events: null },
      ],
      peakTime: "Friday 18:00",
      popularVenues: [{ venue: "Harare Gardens", events: 5 }],
    });
  });

  it("is unavailable, with every count null, when the API has no figures", () => {
    const stats = toCommunityStats(communityFixture({ available: false }));
    expect(stats).toMatchObject({
      available: false,
      totalEvents: null,
      totalAttendees: null,
      activeHosts: null,
      peakTime: null,
      trendingCategories: [],
      popularVenues: [],
    });
  });
});

describe("loadCommunityStats", () => {
  it("reads the API with the city as the locality", async () => {
    const stats = await loadCommunityStats("Harare");
    expect(stats.totalEvents).toBe(42);
    const url = fetchMock.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes("/v1/analytics/community"));
    expect(url).toBe(
      "https://api.example.test/v1/analytics/community?locality=Harare",
    );
  });

  it("is unavailable, not zeros, when the API fails", async () => {
    community = () => json(503, {});
    expect(await loadCommunityStats()).toMatchObject({
      available: false,
      totalEvents: null,
    });
  });

  it("is unavailable without a call when the API is not configured", async () => {
    vi.stubEnv("NYUCHI_API_CLIENT_SECRET", "");
    expect(await loadCommunityStats("Harare")).toMatchObject({
      available: false,
      addressLocality: "Harare",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
