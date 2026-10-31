import { describe, it, expect, vi, beforeEach } from "vitest";

// Anonymous detail reads must not return draft / archived events.
vi.mock("server-only", () => ({}));

let doc: Record<string, unknown> | null = null;

const events = {
  findOne: vi.fn(async () => doc),
  find: vi.fn(() => ({ toArray: async () => (doc ? [doc] : []) })),
  countDocuments: vi.fn(async () => 0),
};
const empty = { find: () => ({ toArray: async () => [] }) };

vi.mock("@/lib/mongo/databases", () => ({
  eventsCollection: vi.fn(async () => events),
  entitiesCollection: vi.fn(async () => empty),
  placesCollection: vi.fn(async () => empty),
  personsCollection: vi.fn(async () => empty),
  entityMembershipsCollection: vi.fn(async () => empty),
}));

import { getEventByIdOrSlug } from "./events";

function eventDoc(status: string) {
  return {
    _id: "evt-1",
    slug: "evt-1",
    name: "Test",
    status,
    startDate: new Date("2030-01-01T10:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  doc = null;
});

describe("getEventByIdOrSlug publicOnly", () => {
  it.each(["draft", "archived"])("hides a %s event", async (status) => {
    doc = eventDoc(status);
    expect(await getEventByIdOrSlug("evt-1", { publicOnly: true })).toBeNull();
  });

  it.each(["published", "live", "ended", "cancelled", "scheduled"])(
    "returns a %s event",
    async (status) => {
      doc = eventDoc(status);
      const event = await getEventByIdOrSlug("evt-1", { publicOnly: true });
      expect(event?.id).toBe("evt-1");
    },
  );

  it("still returns a draft when the caller is not public-only (host pages)", async () => {
    doc = eventDoc("draft");
    expect((await getEventByIdOrSlug("evt-1"))?.id).toBe("evt-1");
  });
});
