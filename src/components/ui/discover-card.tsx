import type { ReactNode } from "react"

import { cn } from "@/lib/ui-utils"
import { buttonVariants } from "@/lib/ui-variants"

export interface DiscoverCardProps {
  variant: "article" | "event" | "circle" | "place"
  /** The item's page: the title link, which covers the card. */
  href: string
  title: string
  eyebrow?: string
  summary?: string
  /** An image URL. Decorative by default: the title names the item. */
  image?: string
  imageAlt?: string
  /** A monogram when there is no image (one or two characters). */
  initial?: string
  /** ISO 8601 for <time datetime>; `dateLabel` is what reads. */
  datetime?: string
  dateLabel?: string
  /** Venue, town or region. */
  place?: string
  /** A large figure, e.g. a temperature or a price. */
  figure?: string
  figureLabel?: string
  /** More facts, in order: "1,204 members", "Running · Harare". */
  meta?: string[]
  badge?: string
  /** neutral | brand | info | success | warning | danger (or a placeholder). */
  badgeTone?: string
  /** An "Open in Mukoko" link to the item in the app. */
  appHref?: string
  appLabel?: string
  /** The title link leaves the site (a news source): rel="external noopener". */
  external?: boolean
  /** Heading level of the title (default 3: under a section's h2). */
  level?: 2 | 3 | 4
  /** Custom media in place of `image`. */
  media?: ReactNode
  /** More actions after "Open in Mukoko". */
  actions?: ReactNode
}

const has = (n: ReactNode) => n !== undefined && n !== null && n !== false

const tones =
  "data-[tone=neutral]:bg-muted data-[tone=neutral]:text-foreground data-[tone=brand]:bg-primary/15 data-[tone=brand]:text-foreground data-[tone=info]:bg-cobalt-container data-[tone=info]:text-cobalt-on-container data-[tone=success]:bg-malachite-container data-[tone=success]:text-malachite-on-container data-[tone=warning]:bg-gold-container data-[tone=warning]:text-gold-on-container data-[tone=danger]:bg-terracotta-container data-[tone=danger]:text-terracotta-on-container"

export function DiscoverCard({
  variant,
  href,
  title,
  eyebrow,
  summary,
  image,
  imageAlt = "",
  initial,
  datetime,
  dateLabel,
  place,
  figure,
  figureLabel,
  meta = [],
  badge,
  badgeTone = "neutral",
  appHref,
  appLabel = "Open in Mukoko",
  external = false,
  level = 3,
  media,
  actions,
}: DiscoverCardProps) {
  const Heading = `h${level}` as "h2" | "h3" | "h4"
  const hasMedia = has(media)
  const top = variant === "article" || variant === "event"
  const hasMeta = place !== undefined || meta.length > 0
  const hasActions = appHref !== undefined || has(actions)
  return (
    <li
      className="group/card relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground transition-shadow duration-200 hover:shadow-sm has-[[data-card-link]:focus-visible]:ring-2 has-[[data-card-link]:focus-visible]:ring-ring"
      data-slot="discover-card"
      data-variant={variant}
    >
      <article className="flex h-full flex-col">
        {hasMedia ? (
          <div className="bg-muted" data-slot="discover-card-media">
            {media}
          </div>
        ) : (
          top &&
          image !== undefined && (
            <img
              src={image}
              alt={imageAlt}
              width="640"
              height="360"
              loading="lazy"
              decoding="async"
              className="aspect-video w-full bg-muted object-cover"
              data-slot="discover-card-media"
            />
          )
        )}
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start gap-3">
            {!top && !hasMedia && image !== undefined ? (
              <img
                src={image}
                alt={imageAlt}
                width="48"
                height="48"
                loading="lazy"
                decoding="async"
                className="size-12 shrink-0 rounded-full bg-muted object-cover"
                data-slot="discover-card-media"
              />
            ) : (
              !top &&
              !hasMedia &&
              initial !== undefined && (
                <span
                  aria-hidden="true"
                  className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 font-serif text-h5 font-bold text-foreground"
                  data-slot="discover-card-initial"
                >
                  {initial}
                </span>
              )
            )}
            <div className="min-w-0 flex-1">
              {eyebrow !== undefined && (
                <p className="mb-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground empty:hidden">
                  {eyebrow}
                </p>
              )}
              <Heading className="font-sans text-h5 leading-snug font-semibold text-balance">
                <a
                  href={href}
                  rel={external ? "external noopener" : undefined}
                  className="text-foreground no-underline outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
                  data-card-link=""
                >
                  {title}
                </a>
              </Heading>
              {dateLabel !== undefined && (
                <p className="mt-1 text-body-sm text-muted-foreground empty:hidden group-data-[variant=event]/card:font-semibold group-data-[variant=event]/card:text-foreground">
                  <time dateTime={datetime}>{dateLabel}</time>
                </p>
              )}
            </div>
            {figure !== undefined && (
              <p className="shrink-0 text-end" data-slot="discover-card-figure">
                <span className="block font-serif text-h3 leading-none font-bold text-foreground">{figure}</span>
                {figureLabel !== undefined && (
                  <span className="mt-1 block text-caption text-muted-foreground empty:hidden">{figureLabel}</span>
                )}
              </p>
            )}
            {badge !== undefined && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full px-3 py-1 text-caption font-medium empty:hidden",
                  tones
                )}
                data-slot="discover-card-badge"
                data-tone={badgeTone}
              >
                {badge}
              </span>
            )}
          </div>
          {summary !== undefined && <p className="line-clamp-3 text-body-sm text-muted-foreground empty:hidden">{summary}</p>}
          {hasMeta && (
            <ul className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground" data-slot="discover-card-meta">
              {place !== undefined && <li className="empty:hidden">{place}</li>}
              {meta.map((m, i) => (
                <li key={`${i}|${m}`} className="empty:hidden">
                  {m}
                </li>
              ))}
            </ul>
          )}
          {hasActions && (
            <div className="relative z-10 flex flex-wrap items-center gap-2" data-slot="discover-card-actions">
              {appHref !== undefined && (
                <a href={appHref} className={buttonVariants({ variant: "outline", size: "sm" })} data-slot="discover-card-app">
                  {appLabel}
                  <span className="sr-only">: {title}</span>
                </a>
              )}
              {actions}
            </div>
          )}
        </div>
      </article>
    </li>
  )
}
