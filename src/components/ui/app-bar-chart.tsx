// TODO(mzizi): local copy of the registry's `app-bar-chart` (contract
// `app/bar-chart`) at 1.2.0, which takes nullable values for k-suppressed
// counts. Upstream: mzizi-dev/mzizi-registry#457. Replace with
// `npx shadcn@latest add https://api.mzizi.dev/v1/ui/app-bar-chart` once
// 1.2.0 is released; do not edit here.
/**
 * BarChart (React) — a bar chart rendered on the server as plain HTML, so it
 * needs no client JavaScript, scales from 320 px to 1920 px without distorting
 * text, and follows the theme through tokens.
 *
 * - `columns`: one bar per point along the bottom (a series over time). Axis
 *   labels are thinned so they never crowd (at most 6 from sm up, first /
 *   middle / last on a phone); every value is in the figures table.
 * - `rows`: one labelled bar per category, the value written beside it.
 *
 * The bars are hidden from screen readers; the exact figures are in a real
 * table under "Show the figures" (WCAG 1.1.1, 1.4.1). Bar sizes are SVG
 * geometry attributes, never inline `style`, so a page's CSP needs no
 * `style-src-attr 'unsafe-inline'`. Implements contract `app/bar-chart` beside
 * `app-bar-chart.astro`, with the same markup. A server component.
 */
interface BarChartPoint {
  label: string;
  /** null: the value is withheld or unknown (drawn as no bar, never as 0). */
  value: number | null;
  /** Optional longer label for the figures table, e.g. a full date. */
  long?: string;
}

interface BarChartProps {
  title: string;
  /** One sentence: what is counted, over what range. */
  caption: string;
  data: BarChartPoint[];
  layout?: "columns" | "rows";
  /** Noun for values in the table header, e.g. "Submissions". */
  valueLabel?: string;
  /** Header for the label column, e.g. "Day". */
  labelHeading?: string;
  id?: string;
  /** BCP 47 locale for number formatting. */
  locale?: string;
  /** What a null value reads as, e.g. "Fewer than 5". */
  missingLabel?: string;
}

function BarChart({
  title,
  caption,
  data,
  layout = "columns",
  valueLabel = "Count",
  labelHeading = "Label",
  id = "chart",
  locale = "en-GB",
  missingLabel = "Not available",
}: BarChartProps) {
  const known = data.flatMap((d) => (d.value === null ? [] : [d.value]));
  const missing = data.length - known.length;
  const max = Math.max(0, ...known);
  const total = known.reduce((sum, v) => sum + v, 0);
  const pct = (v: number) =>
    max > 0 ? Math.max(v > 0 ? 2 : 0, (v / max) * 100) : 0;
  // Two decimals is finer than a pixel at any chart size.
  const geo = (v: number) => String(Math.round(pct(v) * 100) / 100);
  const fmt = (v: number) => v.toLocaleString(locale);
  const show = (v: number | null) => (v === null ? missingLabel : fmt(v));
  // Axis labels are thinned so they never crowd: always the first and the
  // last, never one crowding the last; at most 6 from sm up, and on a phone
  // only the first, the middle (from 5 points) and the last. Every value is
  // in the figures table either way.
  const last = data.length - 1;
  const thin = (count: number) => {
    const step = Math.max(1, Math.ceil(data.length / count));
    return (i: number) =>
      i === 0 || i === last || (i % step === 0 && last - i >= step);
  };
  const wide = thin(6);
  const middle = Math.round(last / 2);
  const narrow = (i: number) =>
    i === 0 || i === last || (i === middle && last >= 4);
  const place = (i: number) =>
    i === 0 ? "left-0" : i === last ? "right-0" : "left-1/2 -translate-x-1/2";
  const labelClass = (i: number) =>
    [
      "absolute top-0 whitespace-nowrap",
      narrow(i) ? "" : "hidden sm:inline",
      place(i),
    ]
      .filter(Boolean)
      .join(" ");
  const phoneLabelClass =
    "absolute top-0 left-1/2 -translate-x-1/2 whitespace-nowrap sm:hidden";

  return (
    <figure
      className="grid min-w-0 gap-4 rounded-lg border border-border bg-card p-5"
      aria-labelledby={`${id}-title`}
      data-slot="bar-chart"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-title`} className="text-h4 font-semibold">
          {title}
        </h3>
        <p className="text-body-sm text-muted-foreground">{caption}</p>
      </div>

      {data.length > 0 && known.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-body-sm text-muted-foreground">
          No figure in this range can be shown: {missingLabel.toLowerCase()} for
          every point.
        </p>
      ) : data.length === 0 || (max === 0 && missing === 0) ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-body-sm text-muted-foreground">
          Nothing to chart in this range.
        </p>
      ) : layout === "columns" ? (
        <div aria-hidden="true">
          <div className="flex h-48 items-end gap-px border-b border-border sm:h-56">
            {data.map((d, i) => (
              <div
                key={`${i}-${d.label}`}
                className="flex h-full min-w-0 flex-1 items-end"
                title={`${d.long ?? d.label}: ${show(d.value)}`}
                data-missing={d.value === null ? "" : undefined}
              >
                <svg
                  className="h-full w-full"
                  viewBox="0 0 10 100"
                  preserveAspectRatio="none"
                  focusable="false"
                  data-bar=""
                >
                  {d.value === null ? (
                    <rect
                      x="3"
                      y="98"
                      width="4"
                      height="2"
                      className="fill-muted-foreground"
                    />
                  ) : (
                    <rect
                      x="0"
                      y={String(100 - Number(geo(d.value)))}
                      width="10"
                      height={geo(d.value)}
                      className="fill-primary"
                    />
                  )}
                </svg>
              </div>
            ))}
          </div>
          <div
            className="mt-2 flex gap-px text-body-sm text-muted-foreground"
            data-axis=""
          >
            {data.map((d, i) => (
              <div key={`${i}-${d.label}`} className="relative min-w-0 flex-1">
                {wide(i) && <span className={labelClass(i)}>{d.label}</span>}
                {!wide(i) && narrow(i) && (
                  <span className={phoneLabelClass}>{d.label}</span>
                )}
              </div>
            ))}
          </div>
          <div className="h-6" />
        </div>
      ) : (
        <ul className="grid gap-3" aria-hidden="true">
          {data.map((d, i) => (
            <li
              key={`${i}-${d.label}`}
              className="grid gap-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-center sm:gap-4"
            >
              <span className="truncate text-body-sm">{d.label}</span>
              <span className="flex items-center gap-3">
                <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <svg
                    className="block h-3 w-full"
                    viewBox="0 0 100 3"
                    preserveAspectRatio="none"
                    focusable="false"
                    data-bar=""
                  >
                    {d.value !== null && (
                      <rect
                        x="0"
                        y="0"
                        width={geo(d.value)}
                        height="3"
                        className="fill-primary"
                      />
                    )}
                  </svg>
                </span>
                <span
                  className={`text-end text-body-sm tabular-nums ${d.value === null ? "text-muted-foreground" : "w-12 font-medium"}`}
                >
                  {show(d.value)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="border-t border-border pt-2">
        <summary className="min-h-11 cursor-pointer py-2 text-body-sm font-medium">
          Show the figures
        </summary>
        <table className="mt-2 w-full text-body-sm">
          <caption className="sr-only">
            {title}: {caption}
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 text-start font-semibold">
                {labelHeading}
              </th>
              <th scope="col" className="py-2 text-end font-semibold">
                {valueLabel}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((d, i) => (
              <tr key={`${i}-${d.label}`}>
                <th scope="row" className="py-2 text-start font-normal">
                  {d.long ?? d.label}
                </th>
                <td
                  className={`py-2 text-end tabular-nums ${d.value === null ? "text-muted-foreground" : ""}`}
                >
                  {show(d.value)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <th scope="row" className="py-2 text-start font-semibold">
                Total
              </th>
              <td className="py-2 text-end font-semibold tabular-nums">
                {missing > 0 ? `At least ${fmt(total)}` : fmt(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </details>
    </figure>
  );
}

export { BarChart, type BarChartPoint, type BarChartProps };
