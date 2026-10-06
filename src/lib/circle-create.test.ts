import { describe, expect, it } from "vitest";
import {
  circlesSiteUrl,
  lines,
  nextSlug,
  slugify,
  tagList,
  toApiBody,
  validateCreateCircle,
  type CreateCircleInput,
} from "./circle-create";

const valid: CreateCircleInput = {
  name: "Harare Makers",
  slug: "harare-makers",
  description: "",
  circleType: "public",
  postApproval: "off",
  inLanguage: "en",
  interestCategoryIds: [],
  placeId: null,
  rules: [],
  tags: [],
};

describe("slugify", () => {
  it("lower-cases, strips accents and keeps inner hyphens only", () => {
    expect(slugify("  Harare Makers!  ")).toBe("harare-makers");
    expect(slugify("Café — Ndebele Poets")).toBe("cafe-ndebele-poets");
    expect(slugify("---")).toBe("");
  });

  it("stays within 64 characters and never ends on a hyphen", () => {
    const s = slugify(`${"a".repeat(63)} b`);
    expect(s.length).toBeLessThanOrEqual(64);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("nextSlug", () => {
  it("offers name-2, then name-3", () => {
    expect(nextSlug("makers")).toBe("makers-2");
    expect(nextSlug("makers-2")).toBe("makers-3");
    expect(nextSlug("a".repeat(64)).length).toBeLessThanOrEqual(64);
  });
});

describe("validateCreateCircle", () => {
  it("passes a valid circle", () => {
    expect(validateCreateCircle(valid)).toEqual({});
  });

  it("checks the name and the slug", () => {
    expect(validateCreateCircle({ ...valid, name: " " }).name).toBeTruthy();
    expect(
      validateCreateCircle({ ...valid, name: "x".repeat(121) }).name,
    ).toBeTruthy();
    for (const slug of [
      "",
      "Upper",
      "-lead",
      "trail-",
      "has space",
      "x".repeat(65),
    ]) {
      expect(validateCreateCircle({ ...valid, slug }).slug).toBeTruthy();
    }
    expect(validateCreateCircle({ ...valid, slug: "categories" }).slug).toMatch(
      /reserved/,
    );
  });

  it("checks the description, type, approval, language and lists", () => {
    expect(
      validateCreateCircle({ ...valid, description: "x".repeat(2001) })
        .description,
    ).toBeTruthy();
    expect(
      validateCreateCircle({ ...valid, circleType: "open" as never })
        .circleType,
    ).toBeTruthy();
    expect(
      validateCreateCircle({ ...valid, postApproval: "some" as never })
        .postApproval,
    ).toBeTruthy();
    expect(
      validateCreateCircle({ ...valid, inLanguage: "xx" }).inLanguage,
    ).toBeTruthy();
    expect(
      validateCreateCircle({
        ...valid,
        interestCategoryIds: Array.from({ length: 21 }, (_, i) => `c${i}`),
      }).interestCategoryIds,
    ).toBeTruthy();
    expect(
      validateCreateCircle({ ...valid, rules: Array(31).fill("r") }).rules,
    ).toBeTruthy();
    expect(
      validateCreateCircle({ ...valid, tags: Array(31).fill("t") }).tags,
    ).toBeTruthy();
  });
});

describe("lines and tagList", () => {
  it("split rules by line and tags by comma", () => {
    expect(lines(" Be kind \n\n No spam ")).toEqual(["Be kind", "No spam"]);
    expect(tagList("#Makers, art, makers ,")).toEqual(["makers", "art"]);
  });
});

describe("toApiBody", () => {
  it("is the snake_case POST /v1/circles body, from Mukoko Events", () => {
    expect(
      toApiBody({
        ...valid,
        description: "  Hi ",
        placeId: "pl-1",
        tags: ["art"],
      }),
    ).toEqual({
      name: "Harare Makers",
      slug: "harare-makers",
      description: "Hi",
      circle_type: "public",
      post_approval: "off",
      in_language: "en",
      interest_category_ids: [],
      place_id: "pl-1",
      rules: [],
      tags: ["art"],
      surface_context: "events",
    });
    expect(toApiBody(valid).description).toBeNull();
  });
});

describe("circlesSiteUrl", () => {
  it("links public and broadcast circles only", () => {
    expect(circlesSiteUrl("makers", "public")).toBe(
      "https://circles.mukoko.com/c/makers",
    );
    expect(circlesSiteUrl("makers", "broadcast")).toBe(
      "https://circles.mukoko.com/c/makers",
    );
    expect(circlesSiteUrl("makers", "private")).toBeNull();
    expect(circlesSiteUrl("makers", "secret")).toBeNull();
  });
});
