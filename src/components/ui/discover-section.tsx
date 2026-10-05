import type { ReactNode } from "react";

import { cn } from "@/lib/ui-utils";
import { buttonVariants } from "@/lib/ui-variants";

export interface DiscoverSectionProps {
  title: string;
  eyebrow?: string;
  description?: string;
  /** Where "See all" goes; no link without it. */
  seeAllHref?: string;
  /** Say what "all" is, e.g. "See every circle" (default "See all"). */
  seeAllLabel?: string;
  /** `muted` puts the band on the secondary surface. */
  tone?: "default" | "muted";
  space?: "default" | "tight";
  /** Heading level (default 2). */
  level?: 2 | 3;
  /** The section's id; its heading is `<id>-title`. Unique per page. */
  id: string;
  /** "ok" or "empty": empty hides the band (a server-filled shell may pass a placeholder). */
  state?: string;
  children?: ReactNode;
}

export function DiscoverSection({
  title,
  eyebrow,
  description,
  seeAllHref,
  seeAllLabel = "See all",
  tone = "default",
  space = "default",
  level = 2,
  id,
  state = "ok",
  children,
}: DiscoverSectionProps) {
  const Heading = `h${level}` as "h2" | "h3";
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        space === "tight" ? "py-12 md:py-16" : "py-16 md:py-24",
        tone === "muted" && "bg-secondary",
        "data-[state=empty]:hidden",
      )}
      data-slot="discover-section"
      data-tone={tone}
      data-state={state}
    >
      <div className="container-custom">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            {eyebrow !== undefined && (
              <p className="eyebrow empty:hidden">{eyebrow}</p>
            )}
            <Heading
              id={titleId}
              className={cn(
                "font-serif text-balance",
                level === 2 ? "text-h2" : "text-h3",
              )}
            >
              {title}
            </Heading>
            {description !== undefined && (
              <p className="mt-3 text-body-lg text-muted-foreground text-pretty empty:hidden">
                {description}
              </p>
            )}
          </div>
          {seeAllHref && (
            <a
              href={seeAllHref}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {seeAllLabel}
            </a>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
