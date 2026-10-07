"use client";

import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  countryCodeFor,
  countryOptions,
  countryStoredName,
} from "@/lib/countries";

export interface CityValue {
  addressLocality: string;
  addressCountry: string;
}

interface ManualCityFieldsProps {
  /** Current city (free text). */
  city: string;
  /** Current country as stored: an English name, a code, or legacy free text. */
  country: string;
  /** Called with the typed city and the stored (English) country name. */
  onChange: (next: CityValue) => void;
  /** Called when the city field loses focus — e.g. to resolve a timezone. */
  onCityBlur?: () => void;
  cityLabel?: string;
  countryLabel?: string;
  className?: string;
}

/** Region of the viewer's browser locale ("en-GB" -> "GB"), when it has one. */
function browserRegion(): string | null {
  if (typeof navigator === "undefined") return null;
  try {
    return new Intl.Locale(navigator.language).maximize().region ?? null;
  } catch {
    return null;
  }
}

const OTHER = "__current";

const fieldClass =
  "w-full px-4 py-3 bg-surface text-foreground placeholder:text-text-tertiary rounded-xl border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/50 text-base";

/**
 * Free-text city plus a country selector covering every ISO 3166-1 country.
 * Global by default: any city in any country can be entered, alongside
 * whatever suggested cities the caller shows. A stored country the list
 * doesn't recognise is kept and shown as its own option, never dropped.
 */
export function ManualCityFields({
  city,
  country,
  onChange,
  onCityBlur,
  cityLabel = "City",
  countryLabel = "Country",
  className,
}: ManualCityFieldsProps) {
  const cityId = useId();
  const countryId = useId();
  // Sorted in the viewer's locale; computed on the client only, after mount,
  // so server and client markup never disagree.
  const [options, setOptions] = useState<{ code: string; label: string }[]>([]);
  const [defaultCode, setDefaultCode] = useState<string>("");
  useEffect(() => {
    setOptions(countryOptions());
    const region = browserRegion();
    if (region && countryCodeFor(region)) setDefaultCode(region);
  }, []);

  const recognised = countryCodeFor(country);
  const selectValue = recognised ?? (country.trim() ? OTHER : defaultCode);

  const storedFor = (code: string) =>
    code === OTHER ? country : countryStoredName(code);

  return (
    <div className={className ?? "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
      <div>
        <Label
          htmlFor={cityId}
          className="block text-sm text-text-secondary mb-2"
        >
          {cityLabel}
        </Label>
        <Input
          id={cityId}
          type="text"
          inputMode="text"
          autoComplete="address-level2"
          value={city}
          onChange={(e) =>
            onChange({
              addressLocality: e.target.value,
              addressCountry: selectValue ? storedFor(selectValue) : "",
            })
          }
          onBlur={onCityBlur}
          placeholder="Any city, e.g. Harare, London, Tokyo"
          className={fieldClass}
        />
      </div>
      <div>
        <Label
          htmlFor={countryId}
          className="block text-sm text-text-secondary mb-2"
        >
          {countryLabel}
        </Label>
        <select
          id={countryId}
          autoComplete="country"
          value={selectValue}
          onChange={(e) =>
            onChange({
              addressLocality: city,
              addressCountry: e.target.value ? storedFor(e.target.value) : "",
            })
          }
          className={fieldClass}
        >
          <option value="">Select a country</option>
          {selectValue === OTHER && <option value={OTHER}>{country}</option>}
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
