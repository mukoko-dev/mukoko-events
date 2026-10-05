export interface CategoryChipProps {
  href: string
  label: string
  /** How many items, e.g. 12 or "1,204". Empty text hides itself. */
  count?: string | number
  /** The current category: true (or "page") sets aria-current="page". */
  current?: boolean | string
}

export function CategoryChip({ href, label, count, current }: CategoryChipProps) {
  const ariaCurrent = current === true ? "page" : current === false || current === undefined ? undefined : current
  return (
    <li data-slot="category-chip">
      <a
        href={href}
        aria-current={ariaCurrent as "page" | undefined}
        className="group/chip inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-body-sm font-medium text-foreground no-underline transition-colors hover:border-foreground aria-[current=page]:border-foreground aria-[current=page]:bg-foreground aria-[current=page]:text-background"
      >
        {label}
        {count !== undefined && (
          <span className="text-caption text-muted-foreground empty:hidden group-aria-[current=page]/chip:text-background">
            {count}
          </span>
        )}
      </a>
    </li>
  )
}
