import { buttonVariants } from "@/lib/ui-variants"

export interface DiscoverSearchProps {
  /** Accessible name of the field and the search landmark, e.g. "Search circles". */
  label: string
  /** Where the form submits (default "/search"). */
  action?: string
  /** The current query. */
  q?: string
  placeholder?: string
  /** The submit button's text (default "Search"). */
  submitLabel?: string
  /** Parameters to carry through as hidden fields (e.g. a category). */
  keep?: Record<string, string>
  /** The field's id; unique per page when there are two forms. */
  id?: string
  /** Show the label above the field instead of only to assistive technology. */
  showLabel?: boolean
  maxlength?: number
}

export function DiscoverSearch({
  label,
  action = "/search",
  q = "",
  placeholder,
  submitLabel = "Search",
  keep = {},
  id = "discover-q",
  showLabel = false,
  maxlength = 100,
}: DiscoverSearchProps) {
  return (
    <form
      action={action}
      method="get"
      role="search"
      aria-label={label}
      className="flex w-full max-w-xl flex-wrap items-end gap-2 sm:flex-nowrap"
      data-slot="discover-search"
    >
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor={id} className={showLabel ? "w-full text-body-sm font-medium text-foreground sm:hidden" : "sr-only"}>
        {label}
      </label>
      <input
        id={id}
        type="search"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        maxLength={maxlength}
        autoComplete="off"
        enterKeyHint="search"
        className="h-12 min-w-0 flex-1 basis-56 rounded-full border border-border bg-input px-4 text-body text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <button type="submit" className={buttonVariants({ variant: "secondary", size: "md" })}>
        {submitLabel}
      </button>
    </form>
  )
}
