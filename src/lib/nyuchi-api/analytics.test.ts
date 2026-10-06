import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __resetTokenCache, asPerson, asService } from "./client";
import {
  clampDays,
  getCommunityAnalytics,
  getEventAnalytics,
  getEventInsights,
  metricValue,
  recordView,
  referrerHost,
} from "./analytics";
import { eventAnalyticsFixture } from "@/__tests__/fixtures/nyuchi-analytics";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  __resetTokenCache();
  fetchMock.mockReset();
  // The token endpoint answers every exchange; the analytics call comes next.
  fetchMock.mockImplementation(async (url: string) =>
    String(url).endsWith("/v1/auth/token")
      ? json(200, { access_token: "platform-jwt", expires_in: 900 })
      : json(200, eventAnalyticsFixture()),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NYUCHI_API_CLIENT_ID", "nyk_test");
  vi.stubEnv("NYUCHI_API_CLIENT_SECRET", "nys_test");
  vi.stubEnv("NYUCHI_API_URL", "https://api.example.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), init };
}

describe("analytics calls", () => {
  it("reads an event's analytics as the person, with the window clamped", async () => {
    const body = await getEventAnalytics(asPerson("authkit"), "evt/1", 500);
    expect(body.totals.views).toEqual({ value: 137, suppressed: false });
    const { url, init } = lastCall();
    expect(url).toBe(
      "https://api.example.test/v1/analytics/events/evt%2F1?days=90",
    );
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer platform-jwt",
    );
  });

  it("reads an event's insights", async () => {
    await getEventInsights(asPerson("authkit"), "evt-1");
    expect(lastCall().url).toBe(
      "https://api.example.test/v1/insights/events/evt-1",
    );
  });

  it("reads community analytics with and without a locality", async () => {
    await getCommunityAnalytics(asService(), "Cape Town");
    expect(lastCall().url).toBe(
      "https://api.example.test/v1/analytics/community?locality=Cape%20Town",
    );
    await getCommunityAnalytics(asService(), "  ");
    expect(lastCall().url).toBe(
      "https://api.example.test/v1/analytics/community",
    );
  });

  it("posts a view with no person in it", async () => {
    await recordView(asService(), {
      subject_type: "Event",
      subject_id: "evt-1",
      referrer_host: "wa.me",
    });
    const { url, init } = lastCall();
    expect(url).toBe("https://api.example.test/v1/analytics/views");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      subject_type: "Event",
      subject_id: "evt-1",
      referrer_host: "wa.me",
    });
  });
});

describe("helpers", () => {
  it("clamps the window to 1..90", () => {
    expect(clampDays(0)).toBe(1);
    expect(clampDays(7)).toBe(7);
    expect(clampDays(1000)).toBe(90);
    expect(clampDays(Number.NaN)).toBe(30);
  });

  it("never turns a suppressed metric into 0", () => {
    expect(metricValue({ value: 12, suppressed: false })).toBe(12);
    expect(metricValue({ value: null, suppressed: true })).toBeNull();
    expect(metricValue({ value: 3, suppressed: true })).toBeNull();
    expect(metricValue(undefined)).toBeNull();
  });

  it("keeps only a foreign referrer's host", () => {
    expect(referrerHost("https://WA.me/abc?x=1")).toBe("wa.me");
    expect(
      referrerHost("https://events.mukoko.com/events", "events.mukoko.com"),
    ).toBeUndefined();
    expect(referrerHost("javascript:alert(1)")).toBeUndefined();
    expect(referrerHost("not a url")).toBeUndefined();
    expect(referrerHost(undefined)).toBeUndefined();
  });
});
