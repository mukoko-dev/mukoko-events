import { describe, it, expect } from "vitest";
import {
  COUNTRY_CODES,
  countryCodeFor,
  countryOptions,
  countryStoredName,
} from "./countries";

describe("countries", () => {
  it("covers every ISO 3166-1 country, not only African ones", () => {
    expect(COUNTRY_CODES.length).toBeGreaterThanOrEqual(249);
    for (const code of ["ZW", "ZA", "GB", "JP", "US", "BR", "IN", "AU"]) {
      expect(COUNTRY_CODES).toContain(code);
    }
    expect(countryOptions()).toHaveLength(COUNTRY_CODES.length);
  });

  it("stores English names that match existing records", () => {
    expect(countryStoredName("ZW")).toBe("Zimbabwe");
    expect(countryStoredName("JP")).toBe("Japan");
  });

  it("maps stored names and codes back to a code, and keeps unknowns as null", () => {
    expect(countryCodeFor("Zimbabwe")).toBe("ZW");
    expect(countryCodeFor("united kingdom")).toBe("GB");
    expect(countryCodeFor("jp")).toBe("JP");
    expect(countryCodeFor("Atlantis")).toBeNull();
    expect(countryCodeFor("")).toBeNull();
  });
});
