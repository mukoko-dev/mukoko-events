/**
 * Event payloads never carry a private or secret circle's id (#164). Lists
 * keep the id of an active public or broadcast circle only; the detail page
 * alone asks for every id and filters it for the viewer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const eventDoc = (id: string, circleId: string | null) => ({
  _id: id,
  name: `Event ${id}`,
  startDate: new Date("2030-01-01T10:00:00Z"),
  status: "published",
  primaryHostEntityId: "ent-1",
  circleId,
});
let docs: Record<string, unknown>[] = [];
const cursor = {
  sort: () => cursor,
  skip: () => cursor,
  limit: () => cursor,
  toArray: async () => docs,
};
const events = {
  find: vi.fn(() => cursor),
  findOne: vi.fn(async () => docs[0] ?? null),
  countDocuments: vi.fn(async () => docs.length),
};
let circleFilter: Record<string, unknown> | null = null;
const circles = {
  find: vi.fn((filter: Record<string, unknown>) => {
    circleFilter = filter;
    const listable = ["c-public", "c-broadcast"];
    return {
      project: () => ({
        toArray: async () =>
          listable
            .filter((id) =>
              ((filter._id as { $in: string[] }).$in ?? []).includes(id),
            )
            .map((_id) => ({ _id })),
      }),
    };
  }),
};
const empty = { find: () => ({ toArray: async () => [] }) };

vi.mock("@/lib/mongo/databases", () => ({
  eventsCollection: vi.fn(async () => events),
  circlesCollection: vi.fn(async () => circles),
  entitiesCollection: vi.fn(async () => empty),
  placesCollection: vi.fn(async () => empty),
  personsCollection: vi.fn(async () => empty),
}));

import { getEventByIdOrSlug, listEvents } from "./events";

beforeEach(() => {
  vi.clearAllMocks();
  circleFilter = null;
  docs = [
    eventDoc("e1", "c-public"),
    eventDoc("e2", "c-broadcast"),
    eventDoc("e3", "c-private"),
    eventDoc("e4", "c-secret"),
    eventDoc("e5", null),
  ];
});

describe("event circle ids", () => {
  it("lists keep only active public and broadcast circle ids", async () => {
    const { events: list } = await listEvents();
    expect(list.map((e) => [e.id, e.eventCircleId])).toEqual([
      ["e1", "c-public"],
      ["e2", "c-broadcast"],
      ["e3", undefined],
      ["e4", undefined],
      ["e5", undefined],
    ]);
    expect(circleFilter).toMatchObject({
      isActive: true,
      circleType: { $in: ["public", "broadcast"] },
    });
  });

  it("a single event read strips a private circle id by default", async () => {
    docs = [eventDoc("e3", "c-private")];
    expect((await getEventByIdOrSlug("e3"))?.eventCircleId).toBeUndefined();
  });

  it("the detail page may ask for every id (it filters for the viewer)", async () => {
    docs = [eventDoc("e3", "c-private")];
    const event = await getEventByIdOrSlug("e3", { keepAllCircleIds: true });
    expect(event?.eventCircleId).toBe("c-private");
    expect(circles.find).not.toHaveBeenCalled();
  });

  it("fails closed when the circle read fails", async () => {
    circles.find.mockImplementationOnce(() => {
      throw new Error("down");
    });
    const { events: list } = await listEvents();
    expect(list.every((e) => e.eventCircleId === undefined)).toBe(true);
  });
});
