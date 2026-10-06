import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const headerValues = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerValues.get(name.toLowerCase()) ?? null,
  }),
}));
const withAuth = vi.fn(
  async () => ({ user: null }) as { user: { id: string } | null },
);
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: () => withAuth() }));
vi.mock("@/lib/auth/dev", () => ({ isDevBypass: () => false }));
// The discovery module also exports Mongo reads; none run here.
vi.mock("@/lib/mongo/events", () => ({}));
vi.mock("@/lib/mongo/lookups", () => ({}));

import { __resetTokenCache } from "@/lib/nyuchi-api/client";
import { trackEventViewAction } from "./discovery";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
  String(url).endsWith("/v1/auth/token")
    ? json(200, { access_token: "svc-jwt", expires_in: 900 })
    : new Response(null, { status: 202 }),
);

function viewBodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([u]) => String(u).endsWith("/v1/analytics/views"))
    .map(([, init]) => JSON.parse(init?.body as string));
}

beforeEach(() => {
  __resetTokenCache();
  fetchMock.mockClear();
  withAuth.mockResolvedValue({ user: null });
  headerValues.clear();
  headerValues.set("host", "events.mukoko.com");
  headerValues.set("x-real-ip", "203.0.113.7");
  headerValues.set("user-agent", "Mozilla/5.0 Chrome/129.0 Safari/537.36");
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NYUCHI_API_CLIENT_ID", "nyk_test");
  vi.stubEnv("NYUCHI_API_CLIENT_SECRET", "nys_test");
  vi.stubEnv("NYUCHI_API_URL", "https://api.example.test");
  vi.stubEnv("VIEW_VISITOR_KEY_SECRET", "visitor-test-secret");
  vi.stubEnv("EDGE_AUTH_SECRET", "edge-test-credential");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("trackEventViewAction", () => {
  it("posts the event, a visitor key and the referrer's host; no address, city or person", async () => {
    headerValues.set("x-vercel-ip-city", "Ashburn");
    await trackEventViewAction("evt-1", "https://wa.me/123?text=hi");
    const [body] = viewBodies();
    expect(Object.keys(body).sort()).toEqual(
      ["referrer_host", "subject_id", "subject_type", "visitor_key"].sort(),
    );
    expect(body).toMatchObject({
      subject_type: "Event",
      subject_id: "evt-1",
      referrer_host: "wa.me",
    });
    expect(body.visitor_key).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(body)).not.toContain("203.0.113.7");
  });

  it("gives repeated views from one visitor the same key (counted once a day)", async () => {
    await trackEventViewAction("evt-1");
    await trackEventViewAction("evt-1");
    const [a, b] = viewBodies();
    expect(a.visitor_key).toBe(b.visitor_key);
  });

  it("spoofed x-forwarded-for or cf-connecting-ip from a non-Cloudflare peer doesn't change the visitor", async () => {
    await trackEventViewAction("evt-1");
    headerValues.set("x-forwarded-for", "1.2.3.4, 203.0.113.7");
    headerValues.set("cf-connecting-ip", "5.6.7.8");
    headerValues.set("x-mukoko-edge-auth", "edge-test-credential");
    await trackEventViewAction("evt-1");
    const [a, b] = viewBodies();
    expect(b.visitor_key).toBe(a.visitor_key);
  });

  it("keys a signed-in person on their id, whatever the address", async () => {
    withAuth.mockResolvedValue({ user: { id: "user_1" } });
    await trackEventViewAction("evt-1");
    headerValues.set("x-real-ip", "198.51.100.9");
    await trackEventViewAction("evt-1");
    const [a, b] = viewBodies();
    expect(a.visitor_key).toBe(b.visitor_key);
  });

  it("records nothing without a trusted address, a secret, the API or a valid id, and never throws", async () => {
    headerValues.delete("x-real-ip");
    await expect(trackEventViewAction("evt-1")).resolves.toBeUndefined();
    headerValues.set("x-real-ip", "172.70.1.2"); // Cloudflare, no edge credential
    await trackEventViewAction("evt-1");
    headerValues.set("x-real-ip", "203.0.113.7");
    vi.stubEnv("VIEW_VISITOR_KEY_SECRET", "");
    await trackEventViewAction("evt-1");
    vi.stubEnv("VIEW_VISITOR_KEY_SECRET", "visitor-test-secret");
    await trackEventViewAction("x".repeat(65));
    await trackEventViewAction("evt 1; drop");
    vi.stubEnv("NYUCHI_API_CLIENT_ID", "");
    await trackEventViewAction("evt-1");
    expect(viewBodies()).toHaveLength(0);
  });

  it("swallows an API failure", async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    await expect(trackEventViewAction("evt-1")).resolves.toBeUndefined();
  });
});

describe("the view path holds no module-level state", () => {
  it.each([
    "src/app/actions/discovery.ts",
    "src/lib/client-address.ts",
    "src/lib/visitor-key.ts",
    "src/lib/nyuchi-api/analytics.ts",
  ])("%s has no module-level Map or Set", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const topLevel = source
      .split("\n")
      .filter((line) =>
        /^(const|let|var|export const|export let)\b/.test(line),
      );
    for (const line of topLevel)
      expect(line).not.toMatch(/new (Map|Set|WeakMap)\b/);
    expect(source).not.toMatch(/^let\s/m);
  });
});
