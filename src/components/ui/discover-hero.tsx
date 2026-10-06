import type { ReactNode } from "react";

import { cn } from "@/lib/ui-utils";

export interface DiscoverHeroCrumb {
  label: string;
  /** Omit on the last crumb: it is the current page. */
  href?: string;
}

export interface DiscoverHeroProps {
  title: string;
  eyebrow?: string;
  lead?: string;
  /** A short count beside the actions, e.g. "1,204 circles on Mukoko". */
  count?: string;
  crumbs?: DiscoverHeroCrumb[];
  size?: "home" | "page";
  /** The search box (a DiscoverSearch). */
  search?: ReactNode;
  /** Links styled as buttons. */
  actions?: ReactNode;
}

const has = (n: ReactNode) => n !== undefined && n !== null && n !== false;

export function DiscoverHero({
  title,
  eyebrow,
  lead,
  count,
  crumbs = [],
  size = "page",
  search,
  actions,
}: DiscoverHeroProps) {
  const hasActions = has(actions) || count !== undefined;
  return (
    <section
      className="gradient-showcase border-b border-border"
      data-slot="discover-hero"
      data-size={size}
    >
      <div
        className={cn(
          "container-custom",
          size === "home" ? "py-16 md:py-24" : "py-12 md:py-16",
        )}
      >
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-4 text-body-sm">
            <ol className="flex flex-wrap items-center gap-2">
              {crumbs.map((c, i) => (
                <li
                  key={`${i}|${c.label}`}
                  className="inline-flex items-center gap-2"
                >
                  {i > 0 && (
                    <span aria-hidden="true" className="text-muted-foreground">
                      /
                    </span>
                  )}
                  {c.href ? (
                    <a
                      className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                      href={c.href}
                    >
                      {c.label}
                    </a>
                  ) : (
                    <span aria-current="page">{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        {eyebrow !== undefined && (
          <p className="eyebrow empty:hidden">{eyebrow}</p>
        )}
        <h1
          className={cn(
            "max-w-4xl font-serif text-h1 text-balance",
            size === "home" && "md:text-display",
          )}
        >
          {title}
        </h1>
        {lead !== undefined && (
          <p className="mt-4 max-w-2xl text-body-lg text-muted-foreground text-pretty empty:hidden">
            {lead}
          </p>
        )}
        {has(search) && <div className="mt-8">{search}</div>}
        {hasActions && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {actions}
            {count !== undefined && (
              <p className="text-body-sm text-muted-foreground empty:hidden">
                {count}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
