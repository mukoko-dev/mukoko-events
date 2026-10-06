/**
 * Circle browse reads and provenance links on the Nyuchi API path. The
 * MongoDB path is covered by src/lib/mongo/circles.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const service = { get: vi.fn() };
const person = { get: vi.fn() };
let signedIn = false;

vi.mock("@/lib/nyuchi-api/session", () => ({
  personApi: vi.fn(async () => person),
  optionalPersonApi: vi.fn(async () => (signedIn ? person : null)),
}));
vi.mock("@/lib/nyuchi-api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/nyuchi-api/client")>()),
  isNyuchiApiConfigured: () => true,
  asService: () => service,
}));
const mongo = vi.hoisted(() => ({
  getCircleSummary: vi.fn(),
  listCirclesByOwner: vi.fn(),
  isCircleOwnedBy: vi.fn(),
  listFeaturedCircles: vi.fn(),
}));
vi.mock("@/lib/mongo/circles", () => mongo);
vi.mock("@/lib/mongo/circle-access", () => ({
  loadCircleAccess: vi.fn(),
  visibleCircleLinkIds: vi.fn(),
}));
vi.mock("@/lib/auth/current-person", () => ({
  resolveViewerPersonId: vi.fn(),
  requireActingPerson: vi.fn(),
}));

import {
  getCircleSummary,
  isCircleOwnedBy,
  listCirclesByOwner,
  listFeaturedCircles,
} from "./circles";
import { NyuchiApiError } from "@/lib/nyuchi-api/client";

const circle = (circleType: string, viewerMembership: unknown = null) => ({
  _id: "c1",
  name: "Runners",
  circleType,
  ownerPersonId: "p-owner",
  isActive: true,
  viewerMembership,
});
const active = (role = "member") => ({ role, membershipStatus: "active" });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn = false;
});

describe("listFeaturedCircles", () => {
  it("reads /featured and lists public and broadcast circles only", async () => {
    service.get.mockResolvedValueOnce({
      data: [
        {
          _id: "a",
          name: "A",
          circleType: "public",
          ownerPersonId: "p",
          memberCount: 9,
        },
        { _id: "b", name: "B", circleType: "broadcast", ownerPersonId: "p" },
        { _id: "p", name: "P", circleType: "private", ownerPersonId: "p" },
        { _id: "s", name: "S", circleType: "secret", ownerPersonId: "p" },
        { _id: "x", name: "X", ownerPersonId: "p" },
      ],
    });
    const out = await listFeaturedCircles(6);
    expect(service.get).toHaveBeenCalledWith("/v1/circles/featured?limit=6");
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
    expect(mongo.listFeaturedCircles).not.toHaveBeenCalled();
  });
});

describe("getCircleSummary", () => {
  it("names a public circle to an anonymous visitor (machine token)", async () => {
    service.get.mockResolvedValueOnce(circle("public"));
    expect(await getCircleSummary("c1", null)).toEqual({
      id: "c1",
      name: "Runners",
    });
  });

  it("never names a private circle to a non-member", async () => {
    service.get.mockResolvedValueOnce(circle("private"));
    expect(await getCircleSummary("c1", null)).toBeNull();
    signedIn = true;
    person.get.mockResolvedValueOnce(
      circle("private", {
        role: "member",
        membershipStatus: "pending_approval",
      }),
    );
    expect(await getCircleSummary("c1", "p-x")).toBeNull();
  });

  it("acts as the signed-in viewer, and names a private circle to its member", async () => {
    signedIn = true;
    person.get.mockResolvedValueOnce(circle("private", active()));
    expect(await getCircleSummary("c1", "p-member")).toEqual({
      id: "c1",
      name: "Runners",
    });
    expect(person.get).toHaveBeenCalledWith("/v1/circles/c1");
    expect(service.get).not.toHaveBeenCalled();
  });

  it("never names a circle the API refuses", async () => {
    service.get.mockRejectedValueOnce(
      new NyuchiApiError(404, "Circle not found"),
    );
    expect(await getCircleSummary("c1", null)).toBeNull();
  });
});

describe("the calendar's circle check", () => {
  it("lists the person's own circles from mine=true", async () => {
    person.get.mockResolvedValueOnce({
      data: [
        { _id: "b", name: "Beta", ownerPersonId: "me" },
        { _id: "a", name: "Alpha", ownerPersonId: "me" },
        { _id: "o", name: "Other", ownerPersonId: "someone" },
      ],
    });
    expect(await listCirclesByOwner("me")).toEqual([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]);
    expect(person.get).toHaveBeenCalledWith("/v1/circles?mine=true&limit=100");
  });

  it("is the owner only when the API says the person owns it", async () => {
    person.get.mockResolvedValueOnce({
      ...circle("secret", active("owner")),
      ownerPersonId: "me",
    });
    expect(await isCircleOwnedBy("c1", "me")).toBe(true);
    person.get.mockResolvedValueOnce(circle("public", active("admin")));
    expect(await isCircleOwnedBy("c1", "me")).toBe(false);
    person.get.mockRejectedValueOnce(
      new NyuchiApiError(404, "Circle not found"),
    );
    expect(await isCircleOwnedBy("c1", "me")).toBe(false);
  });
});
