import { describe, it, expect } from "vitest";
import { inPersonLocationError, normaliseCity } from "./event-location";

describe("inPersonLocationError", () => {
  it("accepts a manually entered city outside Africa", () => {
    expect(
      inPersonLocationError("Barbican Centre", {
        addressLocality: "London",
        addressCountry: "United Kingdom",
      }),
    ).toBeNull();
    expect(
      inPersonLocationError("Shibuya Stream Hall", {
        addressLocality: "Tokyo",
        addressCountry: "Japan",
      }),
    ).toBeNull();
  });

  it("still accepts a suggested African city", () => {
    expect(
      inPersonLocationError("Rainbow Towers", {
        addressLocality: "Harare",
        addressCountry: "Zimbabwe",
      }),
    ).toBeNull();
  });

  it("asks for a location when the venue or city is missing", () => {
    expect(inPersonLocationError("", null)).toMatch(/add a location/);
    expect(
      inPersonLocationError("  ", {
        addressLocality: "London",
        addressCountry: "United Kingdom",
      }),
    ).toMatch(/add a location/);
    expect(
      inPersonLocationError("Hall", {
        addressLocality: "   ",
        addressCountry: "Japan",
      }),
    ).toMatch(/add a location/);
  });

  it("asks for the country when only the city is typed", () => {
    expect(
      inPersonLocationError("Hall", {
        addressLocality: "Tokyo",
        addressCountry: "",
      }),
    ).toMatch(/country/);
  });
});

describe("normaliseCity", () => {
  it("trims the typed values", () => {
    expect(
      normaliseCity({ addressLocality: " Tokyo ", addressCountry: " Japan " }),
    ).toEqual({ addressLocality: "Tokyo", addressCountry: "Japan" });
    expect(normaliseCity(null)).toBeNull();
  });
});
