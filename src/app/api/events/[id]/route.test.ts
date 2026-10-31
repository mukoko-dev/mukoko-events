import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getEventByIdOrSlug = vi.fn();
vi.mock("@/lib/mongo/events", () => ({
  getEventByIdOrSlug: (...a: unknown[]) => getEventByIdOrSlug(...a),
}));
vi.mock("@/app/actions/events", () => ({ updateEventForPerson: vi.fn() }));
vi.mock("@/lib/auth/mcp-actor", () => ({
  resolveActorFromBearer: vi.fn(),
  ActorError: class extends Error {},
}));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/events/:id", () => {
  it("asks for the public-only view (no drafts / archived for anonymous callers)", async () => {
    getEventByIdOrSlug.mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/events/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(404);
    expect(getEventByIdOrSlug).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ publicOnly: true }),
    );
  });
});
