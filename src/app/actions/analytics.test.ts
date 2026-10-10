import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const withAuth = vi.fn();
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: () => withAuth() }));
const devBypass = vi.fn(() => false);
vi.mock("@/lib/auth/dev", () => ({ isDevBypass: () => devBypass() }));

const canManage = vi.fn(async () => true);
vi.mock("@/app/actions/host-registrations", () => ({
  canManageEventAction: () => canManage(),
}));

import { __resetTokenCache } from "@/lib/nyuchi-api/client";
import { getEventAnalyticsAction } from "./analytics";
import {
  eventAnalyticsFixture,
  insightsFixture,
} from "@/__tests__/fixtures/nyuchi-analytics";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A mocked Nyuchi API: the token endpoint plus whatever `routes` answers. */
const routes = new Map<string, () => Response>();
const fetchMock = vi.fn(async (url: string) => {
  const path = new URL(String(url)).pathname;
  if (path === "/v1/auth/token")
    return json(200, { access_token: "platform-jwt", expires_in: 900 });
  const route = routes.get(path);
  return route ? route() : json(404, { detail: "Not found" });
});

beforeEach(() => {
  __resetTokenCache();
  routes.clear();
  fetchMock.mockClear();
  devBypass.mockReturnValue(false);
  canManage.mockResolvedValue(true);
  withAuth.mockResolvedValue({ user: { id: "u1" }, accessToken: "authkit" });
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

describe("getEventAnalyticsAction", () => {
  it("returns the analytics and insights for the host", async () => {
    routes.set("/v1/analytics/events/evt-1", () =>
      json(200, eventAnalyticsFixture()),
    );
    routes.set("/v1/insights/events/evt-1", () => json(200, insightsFixture()));
    const res = await getEventAnalyticsAction("evt-1", 7);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.analytics.totals.views.value).toBe(137);
    expect(res.insights?.items[0].title).toBe("Views are climbing");
    const analyticsUrl = fetchMock.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes("/v1/analytics/events/"));
    expect(analyticsUrl).toContain("?days=7");
  });

  it("keeps the figures when only the insights fail", async () => {
    routes.set("/v1/analytics/events/evt-1", () =>
      json(200, eventAnalyticsFixture()),
    );
    routes.set("/v1/insights/events/evt-1", () => json(500, {}));
    const res = await getEventAnalyticsAction("evt-1");
    expect(res).toMatchObject({ status: "ok", insights: null });
  });

  it("is unavailable when the API refuses (the page already gated the host)", async () => {
    routes.set("/v1/analytics/events/evt-1", () =>
      json(403, { detail: "insufficient scope" }),
    );
    expect(await getEventAnalyticsAction("evt-1")).toEqual({
      status: "unavailable",
    });
  });

  it("never calls the API for someone who does not host the event", async () => {
    canManage.mockResolvedValue(false);
    expect(await getEventAnalyticsAction("evt-1")).toEqual({
      status: "unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is unavailable when the API fails, never zeros", async () => {
    routes.set("/v1/analytics/events/evt-1", () => json(502, {}));
    expect(await getEventAnalyticsAction("evt-1")).toEqual({
      status: "unavailable",
    });
  });

  it("is unavailable without calling anything when the API is not configured", async () => {
    vi.stubEnv("NYUCHI_API_CLIENT_ID", "");
    expect(await getEventAnalyticsAction("evt-1")).toEqual({
      status: "unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is unavailable under the dev sign-in bypass (no API session)", async () => {
    devBypass.mockReturnValue(true);
    expect(await getEventAnalyticsAction("evt-1")).toEqual({
      status: "unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
