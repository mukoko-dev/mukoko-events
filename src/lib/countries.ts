/**
 * Countries for the manual location pickers — every ISO 3166-1 alpha-2 code,
 * from the maintained `i18n-iso-countries` list (no hand-typed table).
 *
 * Built for Africa, globally accessible: an event in Harare, London or Tokyo
 * is created the same way. Labels are shown in the viewer's own locale
 * (`Intl.DisplayNames` with an `undefined` locale), while the stored
 * `addressCountry` stays the English name so it matches the existing event,
 * profile and `places.placesGeo` records (which `resolveCountryTimezone`
 * looks up by name).
 */

import { getAlpha2Codes } from "i18n-iso-countries";

/** Every ISO 3166-1 alpha-2 code, upper-case. */
export const COUNTRY_CODES: readonly string[] = Object.keys(
  getAlpha2Codes(),
).map((c) => c.toUpperCase());

function displayNames(locale?: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(locale, { type: "region" });
  } catch {
    return null;
  }
}

/** Country name in the viewer's locale (or `locale`), falling back to the code. */
export function countryLabel(code: string, locale?: string): string {
  return displayNames(locale)?.of(code) ?? code;
}

/** English country name — the form stored in `addressCountry`. */
export function countryStoredName(code: string): string {
  return countryLabel(code, "en");
}

let byEnglishName: Map<string, string> | null = null;

/**
 * ISO code for a stored country (an English name such as "Zimbabwe", or a
 * code such as "ZW"). Returns `null` for anything unrecognised — callers keep
 * the original text rather than rejecting it.
 */
export function countryCodeFor(
  value: string | null | undefined,
): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (upper.length === 2 && COUNTRY_CODES.includes(upper)) return upper;
  if (!byEnglishName) {
    byEnglishName = new Map(
      COUNTRY_CODES.map((c) => [countryStoredName(c).toLowerCase(), c]),
    );
  }
  return byEnglishName.get(v.toLowerCase()) ?? null;
}

/** All countries as `{ code, label }`, sorted by the viewer-locale label. */
export function countryOptions(
  locale?: string,
): { code: string; label: string }[] {
  const collator = new Intl.Collator(locale);
  return COUNTRY_CODES.map((code) => ({
    code,
    label: countryLabel(code, locale),
  })).sort((a, b) => collator.compare(a.label, b.label));
}
