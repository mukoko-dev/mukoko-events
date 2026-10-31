import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getEventByIdOrSlug = vi.fn();
vi.mock("@/lib/mongo/events", () => ({
  getEventByIdOrSlug: (...a: unknown[]) => getEventByIdOrSlug(...a),
  getTrendingEvents: vi.fn(),
  listEvents: vi.fn(),
}));
const canManageEventAction = vi.fn();
vi.mock("@/app/actions/host-registrations", () => ({
  canManageEventAction: (...a: unknown[]) => canManageEventAction(...a),
}));
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { findEventAction } from "./discovery";

const draft = { id: "evt-1", name: "Draft" };

beforeEach(() => {
  vi.clearAllMocks();
  // public view hides it; the unrestricted lookup finds it
  getEventByIdOrSlug.mockImplementation(
    async (_id: string, opts?: { publicOnly?: boolean }) =>
      opts?.publicOnly ? null : draft,
  );
});

describe("findEventAction", () => {
  it("returns null for an unpublished event when the caller is not its host", async () => {
    canManageEventAction.mockResolvedValue(false);
    expect(await findEventAction("evt-1")).toBeNull();
    // nothing unrestricted is read before the host check passes
    expect(getEventByIdOrSlug).not.toHaveBeenCalledWith("evt-1");
  });

  it("returns the unpublished event to its host", async () => {
    canManageEventAction.mockResolvedValue(true);
    expect(await findEventAction("evt-1")).toEqual(draft);
  });

  it("returns a public event without a host check", async () => {
    getEventByIdOrSlug.mockResolvedValue({ id: "evt-2" });
    expect(await findEventAction("evt-2")).toEqual({ id: "evt-2" });
    expect(canManageEventAction).not.toHaveBeenCalled();
  });
});
