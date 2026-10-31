import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const resolveViewerPersonId = vi.fn();
vi.mock("@/lib/auth/current-person", () => ({
  resolveViewerPersonId: () => resolveViewerPersonId(),
  requireActingPerson: vi.fn(),
}));
const getUserReferralCode = vi.fn();
vi.mock("@/lib/mongo/engagement", () => ({
  getUserReferralCode: (...a: unknown[]) => getUserReferralCode(...a),
  getEventReviews: vi.fn(),
  getEventRatingStats: vi.fn(),
  getReferralLeaderboard: vi.fn(),
  getHostReputation: vi.fn(),
  getEntityReviews: vi.fn(),
  submitEventReview: vi.fn(),
  markReviewHelpful: vi.fn(),
}));
vi.mock("@/lib/mongo/entities", () => ({ ensureHostEntityForPerson: vi.fn() }));

import {
  getUserReferralCodeAction,
  generateUserReferralCodeAction,
} from "./engagement";

const code = { code: "ABC", totalReferrals: 2, totalConversions: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  getUserReferralCode.mockResolvedValue(code);
});

describe("referral code actions are for the signed-in person only", () => {
  it("returns the caller's own code", async () => {
    resolveViewerPersonId.mockResolvedValue("p1");
    expect(await getUserReferralCodeAction("p1")).toEqual(code);
  });

  it("returns null for someone else's id, without reading it", async () => {
    resolveViewerPersonId.mockResolvedValue("p1");
    expect(await getUserReferralCodeAction("p2")).toBeNull();
    expect(getUserReferralCode).not.toHaveBeenCalled();
  });

  it("returns null when signed out", async () => {
    resolveViewerPersonId.mockResolvedValue(null);
    expect(await getUserReferralCodeAction("p1")).toBeNull();
    expect(await generateUserReferralCodeAction("p1")).toEqual({ code: "" });
    expect(getUserReferralCode).not.toHaveBeenCalled();
  });
});
