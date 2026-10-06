/**
 * Event and calendar chat membership (#164): hosts and attendees; the
 * calendar owner and active followers. Fails closed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const events = { findOne: vi.fn() };
const rsvps = { findOne: vi.fn() };
const checkIns = { findOne: vi.fn() };
const entities = { findOne: vi.fn() };
const calendars = { findOne: vi.fn() };
vi.mock("./databases", () => ({
  eventsCollection: vi.fn(async () => events),
  rsvpsCollection: vi.fn(async () => rsvps),
  checkInsCollection: vi.fn(async () => checkIns),
  entitiesCollection: vi.fn(async () => entities),
  calendarsCollection: vi.fn(async () => calendars),
}));
const listHostEntitiesForPerson = vi.hoisted(() => vi.fn());
vi.mock("./entities", () => ({ listHostEntitiesForPerson }));
const isFollowingCalendar = vi.hoisted(() => vi.fn());
vi.mock("./calendars", () => ({ isFollowingCalendar }));

import { isCalendarChatMember, isEventChatMember } from "./chat-membership";

beforeEach(() => {
  vi.clearAllMocks();
  events.findOne.mockResolvedValue({
    _id: "ev",
    primaryHostEntityId: "ent-host",
    hostEntityIds: ["ent-co"],
  });
  rsvps.findOne.mockResolvedValue(null);
  checkIns.findOne.mockResolvedValue(null);
  entities.findOne.mockResolvedValue(null);
  listHostEntitiesForPerson.mockResolvedValue([]);
  calendars.findOne.mockResolvedValue({ _id: "cal", ownerPersonId: "p-owner" });
  isFollowingCalendar.mockResolvedValue(false);
});

describe("isEventChatMember", () => {
  it("lets in an attendee who said yes", async () => {
    rsvps.findOne.mockResolvedValueOnce({ _id: "r" });
    expect(await isEventChatMember("ev", "p")).toBe(true);
    expect(rsvps.findOne.mock.calls[0][0]).toEqual({
      eventId: "ev",
      attendeePersonId: "p",
      rsvpResponse: "RsvpResponseYes",
    });
  });

  it("lets in someone who checked in", async () => {
    checkIns.findOne.mockResolvedValueOnce({ _id: "c" });
    expect(await isEventChatMember("ev", "p")).toBe(true);
  });

  it("lets in a host through any host entity, or as its founder", async () => {
    listHostEntitiesForPerson.mockResolvedValueOnce([{ _id: "ent-co" }]);
    expect(await isEventChatMember("ev", "p")).toBe(true);
    entities.findOne.mockResolvedValueOnce({ _id: "ent-host" });
    expect(await isEventChatMember("ev", "p2")).toBe(true);
  });

  it("keeps out a stranger, the signed-out, a missing event, and on error", async () => {
    expect(await isEventChatMember("ev", "p")).toBe(false);
    expect(await isEventChatMember("ev", null)).toBe(false);
    events.findOne.mockResolvedValueOnce(null);
    expect(await isEventChatMember("ev", "p")).toBe(false);
    rsvps.findOne.mockRejectedValueOnce(new Error("down"));
    expect(await isEventChatMember("ev", "p")).toBe(false);
  });
});

describe("isCalendarChatMember", () => {
  it("lets in the owner and active followers only", async () => {
    expect(await isCalendarChatMember("cal", "p-owner")).toBe(true);
    expect(await isCalendarChatMember("cal", "p")).toBe(false);
    isFollowingCalendar.mockResolvedValueOnce(true);
    expect(await isCalendarChatMember("cal", "p")).toBe(true);
    expect(isFollowingCalendar).toHaveBeenCalledWith("cal", "p");
  });

  it("keeps everyone out of a missing or retired calendar", async () => {
    calendars.findOne.mockResolvedValueOnce(null);
    expect(await isCalendarChatMember("cal", "p-owner")).toBe(false);
    expect(calendars.findOne.mock.calls[0][0]).toEqual({
      _id: "cal",
      isActive: true,
    });
  });
});
