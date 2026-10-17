/**
 * Validation for an in-person event's location, shared by the create and edit
 * forms. Global by default: any venue in any city and country passes — the
 * suggested-city list is a shortcut, never an allow-list.
 */

export interface EventCity {
  addressLocality: string;
  addressCountry: string;
}

/** Error message for an incomplete in-person location, or `null` when it's fine. */
export function inPersonLocationError(
  venue: string,
  city: EventCity | null,
): string | null {
  if (!venue.trim() || !city?.addressLocality.trim())
    return "Please add a location or mark as online event";
  if (!city.addressCountry.trim()) return "Please choose the event's country";
  return null;
}

/** Trim a manually entered city before it is saved. */
export function normaliseCity(city: EventCity | null): EventCity | null {
  if (!city) return null;
  return {
    addressLocality: city.addressLocality.trim(),
    addressCountry: city.addressCountry.trim(),
  };
}
