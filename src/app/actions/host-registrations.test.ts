import { describe, it, expect, vi, beforeEach } from "vitest";

// The host gate: session → person → host entities → the event's host entity.
const withAuth = vi.fn();
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: () => withAuth() }));
vi.mock("@/lib/auth/dev", () => ({
  isDevBypass: () => false,
  DEV_WORKOS_ID: "dev",
}));

const findPerson = vi.fn();
const findEvent = vi.fn();
vi.mock("@/lib/mongo/databases", () => ({
  personsCollection: async () => ({ findOne: findPerson }),
  eventsCollection: async () => ({ findOne: findEvent }),
  rsvpsCollection: async () => ({ findOne: vi.fn() }),
}));

const listHostEntities = vi.fn();
vi.mock("@/lib/mongo/entities", () => ({
  listHostEntitiesForPerson: (id: string) => listHostEntities(id),
}));
vi.mock("@/lib/mongo/host-registrations", () => ({}));

const getEventStats = vi.fn();
vi.mock("@/lib/mongo/stats", () => ({
  getEventStats: (id: string) => getEventStats(id),
}));

import { getEventViewTotalAction } from "./host-registrations";

beforeEach(() => {
  vi.clearAllMocks();
  withAuth.mockResolvedValue({ user: { id: "workos-1" } });
  findPerson.mockResolvedValue({ _id: "person-1" });
  findEvent.mockResolvedValue({ _id: "evt-1", primaryHostEntityId: "ent-1" });
  getEventStats.mockResolvedValue({ eventId: "evt-1", views: 42 });
});

describe("getEventViewTotalAction", () => {
  it("returns the view total to the event's host", async () => {
    listHostEntities.mockResolvedValue([{ _id: "ent-1" }]);
    await expect(getEventViewTotalAction("evt-1")).resolves.toEqual({
      views: 42,
    });
    expect(getEventStats).toHaveBeenCalledWith("evt-1");
  });

  it("refuses a signed-in person who does not host the event", async () => {
    listHostEntities.mockResolvedValue([{ _id: "ent-other" }]);
    await expect(getEventViewTotalAction("evt-1")).rejects.toThrow(
      "Not authorized",
    );
    expect(getEventStats).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    withAuth.mockResolvedValue({ user: null });
    await expect(getEventViewTotalAction("evt-1")).rejects.toThrow(
      "Not authorized",
    );
    expect(getEventStats).not.toHaveBeenCalled();
  });
});
