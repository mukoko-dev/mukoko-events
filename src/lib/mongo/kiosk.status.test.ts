import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const pairings = { findOne: vi.fn(), updateOne: vi.fn() };
const events = { findOne: vi.fn() };
vi.mock("./databases", () => ({
  pairingsCollection: vi.fn(async () => pairings),
  eventsCollection: vi.fn(async () => events),
  checkInsCollection: vi.fn(),
  rsvpsCollection: vi.fn(),
}));
vi.mock("./entities", () => ({ listHostEntitiesForPerson: vi.fn() }));

import { getKioskPairingStatus } from "./kiosk";

const confirmed = {
  _id: "pair-1",
  code: "ABCDEF",
  status: "confirmed",
  eventId: "evt-1",
  expiresAt: new Date(Date.now() + 3_600_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  pairings.findOne.mockResolvedValue(confirmed);
  events.findOne.mockResolvedValue({ name: "E" });
  pairings.updateOne.mockResolvedValue({ matchedCount: 1 });
});

describe("getKioskPairingStatus", () => {
  it("hands the session token out once and retires the code", async () => {
    const first = await getKioskPairingStatus("ABCDEF");
    expect(first).toMatchObject({
      status: "confirmed",
      sessionToken: "pair-1",
    });
    expect(pairings.updateOne).toHaveBeenCalledWith(
      { _id: "pair-1", code: "ABCDEF" },
      expect.objectContaining({
        $set: expect.objectContaining({ code: "used:pair-1" }),
      }),
    );
  });

  it("does not hand the token to a second caller that lost the race", async () => {
    pairings.updateOne.mockResolvedValue({ matchedCount: 0 });
    expect(await getKioskPairingStatus("ABCDEF")).toEqual({
      status: "expired",
    });
  });

  it("still pairs the kiosk if retiring the code is refused", async () => {
    pairings.updateOne.mockRejectedValue(new Error("validator"));
    const out = await getKioskPairingStatus("ABCDEF");
    expect(out).toMatchObject({ status: "confirmed", sessionToken: "pair-1" });
  });
});
