import type { ReactNode } from "react";

import { cn } from "@/lib/ui-utils";

export interface ResultGridProps {
  /** The list's accessible name, e.g. "Circles" or "Featured circles". */
  label: string;
  layout?: "grid" | "list" | "rail";
  /** Columns from 64rem in the grid layout. */
  columns?: 2 | 3 | 4;
  /** "ok" or "empty" (a server-filled shell may pass a placeholder). */
  state?: string;
  /** The status line, e.g. "24 circles". Empty text hides itself. */
  summary?: string;
  /** The cards (DiscoverCard). */
  children?: ReactNode;
  /** The empty state (an EmptyState). */
  empty?: ReactNode;
  /** "Load more" (a LoadMore). */
  more?: ReactNode;
}

const has = (n: ReactNode) => n !== undefined && n !== null && n !== false;

export function ResultGrid({
  label,
  layout = "grid",
  columns = 3,
  state = "ok",
  summary,
  children,
  empty,
  more,
}: ResultGridProps) {
  const list = {
    grid: cn(
      "grid gap-4 sm:grid-cols-2",
      { 2: "", 3: "lg:grid-cols-3", 4: "lg:grid-cols-3 xl:grid-cols-4" }[
        columns
      ],
    ),
    list: "grid gap-4",
    rail: "flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-3 [&>li]:w-72 [&>li]:shrink-0 [&>li]:snap-start focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
  }[layout];
  return (
    <div
      className="group/results grid gap-6"
      data-slot="result-grid"
      data-state={state}
      data-layout={layout}
    >
      {summary !== undefined && (
        <p
          className="text-body-sm text-muted-foreground empty:hidden"
          role="status"
        >
          {summary}
        </p>
      )}
      <ul
        aria-label={label}
        tabIndex={layout === "rail" ? 0 : undefined}
        className={cn(list, "group-data-[state=empty]/results:hidden")}
        data-when="ok"
      >
        {children}
      </ul>
      {has(empty) && (
        <div
          className="hidden group-data-[state=empty]/results:block"
          data-when="empty"
        >
          {empty}
        </div>
      )}
      {has(more) && (
        <div className="group-data-[state=empty]/results:hidden" data-when="ok">
          {more}
        </div>
      )}
    </div>
  );
}
