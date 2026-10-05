import type { ReactNode } from "react"

import { CategoryChip } from "@/components/ui/discover-category-chip"

export interface CategoryChipsItem {
  href: string
  label: string
  count?: string | number
  current?: boolean | string
}

export interface CategoryChipsProps {
  /** The landmark's name, e.g. "Categories". */
  label: string
  items?: CategoryChipsItem[]
  /** An "All" chip first, linking here. */
  allHref?: string
  allLabel?: string
  /** Whether "All" is the current view. */
  allCurrent?: boolean | string
  /** More CategoryChip elements. */
  children?: ReactNode
}

export function CategoryChips({ label, items = [], allHref, allLabel = "All", allCurrent, children }: CategoryChipsProps) {
  return (
    <nav aria-label={label} data-slot="category-chips">
      <ul className="flex flex-wrap gap-2">
        {allHref && <CategoryChip href={allHref} label={allLabel} current={allCurrent} />}
        {items.map((c) => (
          <CategoryChip key={`${c.href}|${c.label}`} href={c.href} label={c.label} count={c.count} current={c.current} />
        ))}
        {children}
      </ul>
    </nav>
  )
}
