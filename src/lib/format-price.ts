/**
 * Format an amount in any ISO 4217 currency, in the viewer's locale
 * (`undefined`). An unknown or malformed code never throws: the amount is
 * shown with the code as given, so a record is displayed rather than dropped.
 */
export function formatCurrency(amount: number, currency = "USD"): string {
  const code = (currency || "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${code} ${new Intl.NumberFormat(undefined).format(amount)}`;
  }
}
