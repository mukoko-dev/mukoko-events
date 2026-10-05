import { CalendarDays, MapIcon } from "lucide-react";
import Link from "next/link";
import { DiscoverHero } from "@/components/ui/discover-hero";
import { DiscoverSearch } from "@/components/ui/discover-search";
import { DiscoverSection } from "@/components/ui/discover-section";
import { CategoryChips } from "@/components/ui/discover-category-chips";
import { ResultGrid } from "@/components/ui/discover-result-grid";
import { DiscoverCard } from "@/components/ui/discover-card";
import type { CategoryWithCount, CityWithCount } from "@/lib/mongo/lookups";
import type { FeaturedCircle } from "@/lib/circles";
import type { FeaturedCalendar } from "@/lib/mongo/calendars";
import {
  isPubliclyListableCircle,
  publicCircleHref,
} from "@/lib/circle-visibility";
import { circlesSiteUrl } from "@/lib/circle-create";
import { CreateCalendarCta } from "./create-calendar-cta";

/**
 * /discover on the Mzizi Discover Standard (#161), built from the registry's
 * React components as they are: DiscoverHero with DiscoverSearch, then
 * DiscoverSection bands of CategoryChips and ResultGrid + DiscoverCard.
 *
 * A BROWSE surface, not a feed: every chip and card links to a scoped
 * drill-down (the /events timeline, a circle, a calendar). Circles and
 * calendars stay distinct: a circle is a COMMUNITY you join; a calendar is
 * an EVENT STREAM you follow.
 *
 * Private and secret circles are never listed (owner rule, 2026-10-04): the
 * read layer excludes them and this component checks each one again.
 */

interface DiscoverBrowseProps {
  categories: CategoryWithCount[];
  circles: FeaturedCircle[];
  calendars: FeaturedCalendar[];
  cities: CityWithCount[];
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const initialOf = (name: string) =>
  name.trim().slice(0, 1).toUpperCase() || "•";

/** Join affordance per circle type. Only public and broadcast are listed. */
const circleBadge: Record<FeaturedCircle["circleType"], string> = {
  public: "Join",
  broadcast: "Follow",
};

/**
 * Where a featured circle links: its page on circles.mukoko.com when it has
 * a slug (the same address circles.mukoko.com lists it under), else its page
 * here.
 */
function circleHref(c: FeaturedCircle): { href: string; external: boolean } {
  const site = c.slug ? circlesSiteUrl(c.slug, c.circleType) : null;
  return site
    ? { href: site, external: true }
    : { href: publicCircleHref(c.id), external: false };
}

export function DiscoverBrowse({
  categories,
  circles,
  calendars,
  cities,
}: DiscoverBrowseProps) {
  // Defence in depth: never a private, secret or untyped circle.
  const listableCircles = circles.filter((c) =>
    isPubliclyListableCircle(c.circleType),
  );

  return (
    <>
      <DiscoverHero
        size="home"
        title="Discover"
        lead="Browse by category, find your circles, or explore what's happening in your city."
        search={
          <DiscoverSearch
            label="Search events"
            action="/search"
            placeholder="Search events, places and hosts"
          />
        }
        actions={
          <nav aria-label="More ways to explore" className="flex gap-3">
            <Link
              href="/events"
              className="inline-flex items-center gap-1.5 text-body-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              <CalendarDays className="size-4" aria-hidden />
              All events
            </Link>
            <Link
              href="/map"
              className="inline-flex items-center gap-1.5 text-body-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              <MapIcon className="size-4" aria-hidden />
              Near me
            </Link>
          </nav>
        }
      />

      <DiscoverSection
        id="discover-categories"
        title="Browse by category"
        description="Pick a lane: each one opens a live timeline."
        seeAllHref="/events"
        seeAllLabel="All events"
        space="tight"
      >
        {categories.length > 0 ? (
          <CategoryChips
            label="Event categories"
            items={categories.map((c) => ({
              href: `/events?category=${encodeURIComponent(c.id)}`,
              label: c.name,
              count: c.eventCount,
            }))}
          />
        ) : (
          <p className="text-body text-muted-foreground">
            Categories are warming up. Check back soon.
          </p>
        )}
      </DiscoverSection>

      <DiscoverSection
        id="discover-circles"
        title="Featured circles"
        description="Communities that gather here. Join one and never miss their events."
        seeAllHref="/circles"
        seeAllLabel="Your circles"
        tone="muted"
        space="tight"
      >
        <ResultGrid
          label="Featured circles"
          columns={2}
          state={listableCircles.length > 0 ? "ok" : "empty"}
          empty={
            <p className="text-body text-muted-foreground">
              No circles to feature yet. Hosts open one alongside their events.
            </p>
          }
        >
          {listableCircles.map((c) => {
            const { href, external } = circleHref(c);
            return (
              <DiscoverCard
                key={c.id}
                variant="circle"
                href={href}
                external={external}
                title={c.name}
                initial={initialOf(c.name)}
                summary={c.description ?? undefined}
                figure={String(c.memberCount)}
                figureLabel={c.memberCount === 1 ? "member" : "members"}
                badge={circleBadge[c.circleType]}
                badgeTone="brand"
              />
            );
          })}
        </ResultGrid>
      </DiscoverSection>

      <DiscoverSection
        id="discover-calendars"
        title="Featured calendars"
        description="Curated event streams. Follow one and every gathering lands on your radar."
        space="tight"
      >
        <div className="mb-6 empty:hidden">
          <CreateCalendarCta />
        </div>
        <ResultGrid
          label="Featured calendars"
          columns={2}
          state={calendars.length > 0 ? "ok" : "empty"}
          empty={
            <p className="text-body text-muted-foreground">
              No calendars to follow yet. Hosts curate them from their events.
            </p>
          }
        >
          {calendars.map((c) => (
            <DiscoverCard
              key={c.id}
              variant="circle"
              href={`/calendars/${encodeURIComponent(c.slug)}`}
              title={c.name}
              eyebrow="Calendar"
              initial={initialOf(c.name)}
              summary={c.description ?? undefined}
              figure={String(c.followerCount)}
              figureLabel={c.followerCount === 1 ? "follower" : "followers"}
              meta={[plural(c.eventCount, "event", "events")]}
              badge="Follow"
              badgeTone="brand"
            />
          ))}
        </ResultGrid>
      </DiscoverSection>

      <DiscoverSection
        id="discover-cities"
        title="Explore by city"
        description="Where the gatherings are happening right now."
        seeAllHref="/map"
        seeAllLabel="Open the map"
        tone="muted"
        space="tight"
      >
        {cities.length > 0 ? (
          <CategoryChips
            label="Cities"
            items={cities.map((c) => ({
              href: `/events?city=${encodeURIComponent(c.addressLocality)}`,
              label: c.addressCountry
                ? `${c.addressLocality}, ${c.addressCountry}`
                : c.addressLocality,
              count: c.eventCount,
            }))}
          />
        ) : (
          <p className="text-body text-muted-foreground">
            No cities with upcoming events yet. Be the first to{" "}
            <Link
              href="/events/create"
              className="text-primary underline-offset-4 hover:underline"
            >
              host one
            </Link>
            .
          </p>
        )}
      </DiscoverSection>
    </>
  );
}
