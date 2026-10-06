import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const headerValues = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerValues.get(name.toLowerCase()) ?? null,
  }),
}));
// The discovery module also exports Mongo reads; none run here.
vi.mock("@/lib/mongo/events", () => ({}));
vi.mock("@/lib/mongo/lookups", () => ({}));

import { __resetTokenCache } from "@/lib/nyuchi-api/client";
import { __resetViewThrottle } from "@/lib/view-throttle";
import { trackEventViewAction } from "./discovery";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn(async (url: string) =>
  String(url).endsWith("/v1/auth/token")
    ? json(200, { access_token: "svc-jwt", expires_in: 900 })
    : new Response(null, { status: 202 }),
);

function viewBody(): unknown {
  const call = fetchMock.mock.calls.find(([u]) =>
    String(u).endsWith("/v1/analytics/views"),
  ) as [string, RequestInit] | undefined;
  return call ? JSON.parse(call[1].body as string) : undefined;
}

beforeEach(() => {
  __resetTokenCache();
  __resetViewThrottle();
  fetchMock.mockClear();
  headerValues.clear();
  headerValues.set("host", "events.mukoko.com");
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NYUCHI_API_CLIENT_ID", "nyk_test");
  vi.stubEnv("NYUCHI_API_CLIENT_SECRET", "nys_test");
  vi.stubEnv("NYUCHI_API_URL", "https://api.example.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("trackEventViewAction", () => {
  it("posts the view with the referrer's host and the edge city, no person", async () => {
    headerValues.set("x-real-ip", "203.0.113.7");
    headerValues.set("x-vercel-ip-city", "Harare");
    await trackEventViewAction("evt-1", "https://wa.me/123?text=hi");
    expect(viewBody()).toEqual({
      subject_type: "Event",
      subject_id: "evt-1",
      referrer_host: "wa.me",
      locality: "Harare",
    });
  });

  it("drops our own host as a referrer", async () => {
    await trackEventViewAction("evt-1", "https://events.mukoko.com/events");
    expect(viewBody()).toEqual({ subject_type: "Event", subject_id: "evt-1" });
  });

  it("ignores an id that is not an event id, and caps a looping caller", async () => {
    await trackEventViewAction("x".repeat(65));
    await trackEventViewAction("evt 1; drop");
    expect(fetchMock).not.toHaveBeenCalled();
    headerValues.set("x-real-ip", "203.0.113.7");
    // A spoofed first x-forwarded-for entry is not the key.
    for (let i = 0; i < 40; i++) {
      headerValues.set("x-forwarded-for", `198.51.100.${i}, 203.0.113.7`);
      await trackEventViewAction("evt-1");
    }
    const posts = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith("/v1/analytics/views"),
    );
    // 5 per source per event per 10 minutes.
    expect(posts).toHaveLength(5);
  });

  it("records nothing, and does not throw, when the API is not configured", async () => {
    vi.stubEnv("NYUCHI_API_CLIENT_ID", "");
    await expect(trackEventViewAction("evt-1")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows an API failure", async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    await expect(trackEventViewAction("evt-1")).resolves.toBeUndefined();
  });
});
