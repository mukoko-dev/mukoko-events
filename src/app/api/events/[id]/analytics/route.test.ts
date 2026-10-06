import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ActorError, requireHost } = vi.hoisted(() => {
  class ActorError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return { ActorError, requireHost: vi.fn() };
});
vi.mock("@/lib/auth/mcp-host", () => ({
  ActorError,
  requireBearerEventHost: (auth: string | null, id: string) =>
    requireHost(auth, id),
}));

import { __resetTokenCache } from "@/lib/nyuchi-api/client";
import { GET } from "./route";
import {
  eventAnalyticsFixture,
  hidden,
  m,
} from "@/__tests__/fixtures/nyuchi-analytics";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let analytics: () => Response = () => json(200, eventAnalyticsFixture());
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const path = new URL(String(url)).pathname;
  if (path === "/v1/auth/token") {
    // The MCP's own WorkOS token is what gets exchanged.
    expect(init?.body as string).toContain("subject_token=workos-token");
    return json(200, { access_token: "platform-jwt", expires_in: 900 });
  }
  if (path === "/v1/analytics/events/evt-1") return analytics();
  return json(404, {});
});

function call(auth = "Bearer workos-token", query = "") {
  return GET(
    new Request(`https://events.example/api/events/my-slug/analytics${query}`, {
      headers: { Authorization: auth },
    }),
    { params: Promise.resolve({ id: "my-slug" }) },
  );
}

beforeEach(() => {
  __resetTokenCache();
  fetchMock.mockClear();
  analytics = () => json(200, eventAnalyticsFixture());
  requireHost.mockResolvedValue({
    person: { _id: "p1" },
    event: { _id: "evt-1" },
  });
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

describe("GET /api/events/:id/analytics", () => {
  it("keeps the { analytics } shape, from the API, with no made-up figures", async () => {
    const res = await call("Bearer workos-token", "?days=7");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analytics).toMatchObject({
      eventId: "evt-1",
      views: 137,
      uniqueViews: null,
      rsvps: 6,
      checkins: 2,
      referrals: null,
      remaining: 4,
      checkinRate: 33,
      source: "mongo",
    });
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).endsWith("/v1/analytics/events/evt-1?days=7"),
      ),
    ).toBe(true);
  });

  it("reports suppressed totals as null, never 0", async () => {
    analytics = () =>
      json(
        200,
        eventAnalyticsFixture({
          totals: {
            views: m(3),
            rsvps: hidden,
            checkins: m(1),
            checkin_rate: null,
          },
        }),
      );
    const body = await (await call()).json();
    expect(body.analytics).toMatchObject({
      rsvps: null,
      remaining: null,
      checkinRate: null,
    });
  });

  it("passes the host gate's refusal through", async () => {
    requireHost.mockRejectedValue(
      new ActorError("You do not host this event.", 403),
    );
    const res = await call();
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is 503 'not available yet' when the API is not configured", async () => {
    vi.stubEnv("NYUCHI_API_CLIENT_ID", "");
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Analytics are not available yet.",
    });
  });

  it("is 503 when the API fails or has no figures", async () => {
    analytics = () => json(500, {});
    expect((await call()).status).toBe(503);
    analytics = () => json(200, eventAnalyticsFixture({ available: false }));
    expect((await call()).status).toBe(503);
  });

  it("passes the API's own 403 through", async () => {
    analytics = () => json(403, { detail: "no" });
    expect((await call()).status).toBe(403);
  });
});
