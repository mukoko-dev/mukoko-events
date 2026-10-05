import { describe, it, expect } from "vitest";
import {
  LISTABLE_CIRCLE_TYPES,
  isPubliclyListableCircle,
  publicCircleHref,
} from "./circle-visibility";

describe("isPubliclyListableCircle", () => {
  it("lists only public and broadcast circles", () => {
    expect(LISTABLE_CIRCLE_TYPES).toEqual(["public", "broadcast"]);
    expect(isPubliclyListableCircle("public")).toBe(true);
    expect(isPubliclyListableCircle("broadcast")).toBe(true);
  });

  it("never lists private or secret circles", () => {
    expect(isPubliclyListableCircle("private")).toBe(false);
    expect(isPubliclyListableCircle("secret")).toBe(false);
  });

  it("fails closed on a missing or unknown type", () => {
    for (const t of [undefined, null, "", "Public", "open", 1, {}]) {
      expect(isPubliclyListableCircle(t)).toBe(false);
    }
  });
});

describe("publicCircleHref", () => {
  it("points at the circle's public page", () => {
    expect(publicCircleHref("11111111-1111-4111-8111-111111111111")).toBe(
      "/circles/11111111-1111-4111-8111-111111111111",
    );
  });

  it("encodes the id so it can't escape the path segment", () => {
    expect(publicCircleHref("a/../b?x=1")).toBe("/circles/a%2F..%2Fb%3Fx%3D1");
  });
});
