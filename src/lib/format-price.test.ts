import { describe, it, expect } from "vitest";
import { formatCurrency } from "./format-price";

const fmt = (n: number, c: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(
    n,
  );

describe("formatCurrency", () => {
  it("formats any ISO 4217 code in the viewer's locale", () => {
    expect(formatCurrency(25, "GBP")).toBe(fmt(25, "GBP"));
    expect(formatCurrency(25, "zwg")).toBe(fmt(25, "ZWG"));
    expect(formatCurrency(1500, "JPY")).toBe(fmt(1500, "JPY"));
  });

  it("defaults to USD", () => {
    expect(formatCurrency(10)).toBe(fmt(10, "USD"));
  });

  it("shows the amount with the code instead of throwing on a malformed code", () => {
    expect(formatCurrency(10, "not-a-code")).toContain("NOT-A-CODE");
  });
});
