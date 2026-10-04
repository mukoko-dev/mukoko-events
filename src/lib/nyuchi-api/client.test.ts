import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __resetTokenCache,
  asPerson,
  asService,
  NyuchiApiError,
  NyuchiApiNotConfigured,
  PERSON_SCOPE,
  seg,
} from "./client";

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
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NYUCHI_API_CLIENT_ID", "nyk_test");
  vi.stubEnv("NYUCHI_API_CLIENT_SECRET", "nys_test");
  vi.stubEnv("NYUCHI_API_URL", "https://api.example.test/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("asPerson", () => {
  it("exchanges the AuthKit token, then calls with the person token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, { access_token: "person-jwt", expires_in: 300 }),
      )
      .mockResolvedValueOnce(json(200, { data: [] }));

    const body = await asPerson("authkit-token").get("/v1/circles?mine=true");
    expect(body).toEqual({ data: [] });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://api.example.test/v1/auth/token");
    const form = new URLSearchParams(tokenInit.body as string);
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:token-exchange",
    );
    expect(form.get("subject_token")).toBe("authkit-token");
    expect(form.get("scope")).toBe(PERSON_SCOPE);
    expect(tokenInit.headers["X-Client-Id"]).toBe("nyk_test");

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.example.test/v1/circles?mine=true");
    expect(init.headers.authorization).toBe("Bearer person-jwt");
  });

  it("caches the exchanged token for its lifetime", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, { access_token: "person-jwt", expires_in: 300 }),
      )
      .mockImplementation(async () => json(200, { data: [] }));
    const api = asPerson("authkit-token");
    await api.get("/v1/circles");
    await api.get("/v1/circles");
    const exchanges = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith("/v1/auth/token"),
    );
    expect(exchanges).toHaveLength(1);
  });

  it("provisions a first-time person once, then exchanges again", async () => {
    fetchMock
      .mockResolvedValueOnce(json(404, { error: "person_not_found" }))
      .mockResolvedValueOnce(json(201, { person_id: "p1", created: true }))
      .mockResolvedValueOnce(json(200, { access_token: "jwt", expires_in: 60 }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    await asPerson("new-person").post("/v1/circles/c1/join");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.example.test/v1/identity/persons/ensure",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("passes the API's refusal on with its status and sentence", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: "jwt", expires_in: 60 }))
      .mockResolvedValueOnce(
        json(403, { detail: "You are not a member of this circle" }),
      );
    const err = await asPerson("t")
      .post("/v1/circles/c1/posts", { article_body: "hi" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NyuchiApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe("You are not a member of this circle");
  });
});

describe("asService", () => {
  it("uses a client_credentials machine token", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: "m2m", expires_in: 300 }))
      .mockResolvedValueOnce(json(200, { data: [] }));
    await asService().get("/v1/circles/featured?limit=6");
    const form = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe("Bearer m2m");
  });
});

describe("configuration", () => {
  it("fails loudly without credentials — no fallback", async () => {
    vi.stubEnv("NYUCHI_API_CLIENT_ID", "");
    await expect(asService().get("/v1/circles")).rejects.toBeInstanceOf(
      NyuchiApiNotConfigured,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses paths outside /v1/", async () => {
    await expect(asService().get("/admin")).rejects.toThrow(/\/v1\//);
  });
});

describe("seg", () => {
  it("encodes an id for a path segment", () => {
    expect(seg("a/b?c")).toBe("a%2Fb%3Fc");
    expect(() => seg("")).toThrow();
  });
});
