import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getEventByIdOrSlug = vi.fn();
vi.mock("@/lib/mongo/events", () => ({
  getEventByIdOrSlug: (...a: unknown[]) => getEventByIdOrSlug(...a),
}));
vi.mock("@/app/actions/events", () => ({ updateEventForPerson: vi.fn() }));
const requireBearerEventHost = vi.fn();
vi.mock("@/lib/auth/mcp-host", () => ({
  requireBearerEventHost: (...a: unknown[]) => requireBearerEventHost(...a),
}));
vi.mock("@/lib/auth/mcp-actor", () => ({
  resolveActorFromBearer: vi.fn(),
  ActorError: class extends Error {},
}));

import { GET } from "./route";

const draft = { id: "abc", name: "Draft" };
const call = (headers: Record<string, string> = {}) =>
  GET(new Request("http://x/api/events/abc", { headers }), {
    params: Promise.resolve({ id: "abc" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // public view hides the draft; the unrestricted lookup finds it
  getEventByIdOrSlug.mockImplementation(
    async (_id: string, opts?: { publicOnly?: boolean }) =>
      opts?.publicOnly ? null : draft,
  );
});

describe("GET /api/events/:id", () => {
  it("asks for the public-only view first", async () => {
    await call();
    expect(getEventByIdOrSlug).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ publicOnly: true }),
    );
  });

  it("404s an unpublished event for an anonymous caller", async () => {
    const res = await call();
    expect(res.status).toBe(404);
    expect(requireBearerEventHost).not.toHaveBeenCalled();
  });

  it("404s an unpublished event for a bearer who is not the host", async () => {
    requireBearerEventHost.mockRejectedValue(new Error("not a host"));
    const res = await call({ Authorization: "Bearer t" });
    expect(res.status).toBe(404);
  });

  it("returns an unpublished event to its host", async () => {
    requireBearerEventHost.mockResolvedValue({});
    const res = await call({ Authorization: "Bearer t" });
    expect(res.status).toBe(200);
    expect((await res.json()).event).toEqual(draft);
  });
});
