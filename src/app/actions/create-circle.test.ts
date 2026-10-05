/**
 * createCircleAction — POST /v1/circles as the signed-in person; never a
 * MongoDB write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let configured = true;
const api = { post: vi.fn() };
let signedIn = true;

vi.mock("@/lib/nyuchi-api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/nyuchi-api/client")>()),
  isNyuchiApiConfigured: () => configured,
}));
vi.mock("@/lib/nyuchi-api/session", async () => {
  class SignInRequired extends Error {}
  return {
    SignInRequired,
    personApi: vi.fn(async () => {
      if (!signedIn)
        throw new SignInRequired("You must be signed in to do that.");
      return api;
    }),
  };
});
const ensurePlaceFromOsmSuggestion = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/geocode", () => ({ ensurePlaceFromOsmSuggestion }));
const mongo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mongo/databases", () => new Proxy({}, { get: () => mongo }));

import { createCircleAction } from "./create-circle";
import { NyuchiApiError } from "@/lib/nyuchi-api/client";
import type { CreateCircleInput } from "@/lib/circle-create";

const input: CreateCircleInput = {
  name: "Harare Makers",
  slug: "harare-makers",
  description: "People who make things.",
  circleType: "private",
  postApproval: "all",
  inLanguage: "en",
  interestCategoryIds: ["arts"],
  placeId: null,
  rules: ["Be kind"],
  tags: ["makers"],
};

beforeEach(() => {
  vi.clearAllMocks();
  configured = true;
  signedIn = true;
});

describe("createCircleAction", () => {
  it("creates through the API and returns the new circle", async () => {
    api.post.mockResolvedValueOnce({
      _id: "c-new",
      slug: "harare-makers",
      circleType: "private",
    });
    const result = await createCircleAction(input);
    expect(result).toEqual({
      ok: true,
      circle: { id: "c-new", slug: "harare-makers", circleType: "private" },
    });
    expect(api.post).toHaveBeenCalledWith("/v1/circles", {
      name: "Harare Makers",
      slug: "harare-makers",
      description: "People who make things.",
      circle_type: "private",
      post_approval: "all",
      in_language: "en",
      interest_category_ids: ["arts"],
      place_id: null,
      rules: ["Be kind"],
      tags: ["makers"],
      surface_context: "events",
    });
    expect(mongo).not.toHaveBeenCalled();
  });

  it("promotes an OpenStreetMap place pick to a place id", async () => {
    ensurePlaceFromOsmSuggestion.mockResolvedValueOnce("pl-9");
    api.post.mockResolvedValueOnce({ _id: "c-new" });
    await createCircleAction(input, {
      name: "Harare",
      address: "",
      city: "Harare",
      country: "Zimbabwe",
      latitude: -17.8,
      longitude: 31.05,
      osmType: "relation",
      osmId: 1,
    });
    expect(api.post.mock.calls[0][1]).toMatchObject({ place_id: "pl-9" });
  });

  it("refuses invalid fields before calling the API", async () => {
    const result = await createCircleAction({ ...input, slug: "Not A Slug" });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { slug: expect.any(String) },
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("is not available without the API key, and never writes MongoDB", async () => {
    configured = false;
    const result = await createCircleAction(input);
    expect(result).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/isn't available/),
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(mongo).not.toHaveBeenCalled();
  });

  it("asks a signed-out person to sign in", async () => {
    signedIn = false;
    expect(await createCircleAction(input)).toMatchObject({
      ok: false,
      signInRequired: true,
    });
  });

  it("offers another slug on 409", async () => {
    api.post.mockRejectedValueOnce(
      new NyuchiApiError(409, "That slug is taken; choose another"),
    );
    expect(await createCircleAction(input)).toMatchObject({
      ok: false,
      fieldErrors: { slug: "That address is taken. Choose another." },
      suggestedSlug: "harare-makers-2",
    });
  });

  it("puts 422 errors next to their fields", async () => {
    api.post.mockRejectedValueOnce(
      new NyuchiApiError(422, "bad", null, [
        {
          loc: ["body", "slug"],
          msg: "Value error, That slug is reserved; choose another",
        },
        {
          loc: ["body", "rules", 3],
          msg: "String should have at most 300 characters",
        },
      ]),
    );
    expect(await createCircleAction(input)).toMatchObject({
      ok: false,
      fieldErrors: {
        slug: "Value error, That slug is reserved; choose another",
        rules: "String should have at most 300 characters",
      },
    });
  });
});
