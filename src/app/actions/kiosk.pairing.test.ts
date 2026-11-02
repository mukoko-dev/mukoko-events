import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: vi.fn() }));
vi.mock("@/lib/mongo/databases", () => ({ personsCollection: vi.fn() }));
vi.mock("@/lib/mongo/users", () => ({ syncPersonFromWorkos: vi.fn() }));
vi.mock("@/lib/auth/dev", () => ({
  isDevBypass: () => false,
  DEV_WORKOS_ID: "d",
  DEV_EMAIL: "d",
  DEV_NAME: "d",
}));

const getKioskPairingStatus = vi.fn();
vi.mock("@/lib/mongo/kiosk", () => ({
  requestKioskPairing: vi.fn(),
  getKioskPairingStatus: (...a: unknown[]) => getKioskPairingStatus(...a),
  confirmKioskPairing: vi.fn(),
  getKioskSession: vi.fn(),
  endKioskSession: vi.fn(),
  checkinViaKiosk: vi.fn(),
}));
const getDailyUsage = vi.fn();
const consumeDailyUsage = vi.fn();
vi.mock("@/lib/mongo/usage-limits", () => ({
  getDailyUsage: (...a: unknown[]) => getDailyUsage(...a),
  consumeDailyUsage: (...a: unknown[]) => consumeDailyUsage(...a),
}));

import { getKioskPairingStatusAction } from "./kiosk";

beforeEach(() => {
  vi.clearAllMocks();
  getDailyUsage.mockResolvedValue(0);
  consumeDailyUsage.mockResolvedValue(1);
});

describe("getKioskPairingStatusAction guess limiting", () => {
  it("counts a miss against the caller's network", async () => {
    getKioskPairingStatus.mockResolvedValue({ status: "expired" });
    await getKioskPairingStatusAction("ABCDEF");
    expect(consumeDailyUsage).toHaveBeenCalledWith(
      expect.objectContaining({ counterType: "kioskProbe" }),
    );
  });

  it("does not count a live code being polled", async () => {
    getKioskPairingStatus.mockResolvedValue({ status: "pending" });
    await getKioskPairingStatusAction("ABCDEF");
    expect(consumeDailyUsage).not.toHaveBeenCalled();
  });

  it("stops looking codes up once the network is over the limit", async () => {
    getDailyUsage.mockResolvedValue(100);
    getKioskPairingStatus.mockResolvedValue({
      status: "confirmed",
      sessionToken: "t",
    });
    expect(await getKioskPairingStatusAction("ABCDEF")).toEqual({
      status: "expired",
    });
    expect(getKioskPairingStatus).not.toHaveBeenCalled();
  });
});
