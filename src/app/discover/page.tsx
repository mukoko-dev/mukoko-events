import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site-url";
import { DiscoverBrowse } from "./discover-browse";
import {
  listCategoriesWithCounts,
  listCitiesWithCounts,
  type CategoryWithCount,
  type CityWithCount,
} from "@/lib/mongo/lookups";
import { listFeaturedCircles, type FeaturedCircle } from "@/lib/circles";
import {
  listFeaturedCalendars,
  type FeaturedCalendar,
} from "@/lib/mongo/calendars";

const DESCRIPTION =
  "Browse community gatherings on Mukoko Events — by category, by circle, or by city. Find what brings your people together.";

// The Discover Standard's head (#161): title "<page> · <Service>",
// canonical, en_GB Open Graph, and WebSite + SearchAction JSON-LD below.
export const metadata: Metadata = {
  title: { absolute: "Discover · Mukoko Events" },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/discover` },
  openGraph: {
    title: "Discover · Mukoko Events",
    description: DESCRIPTION,
    url: `${SITE_URL}/discover`,
    siteName: "Mukoko Events",
    locale: "en_GB",
    type: "website",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Mukoko Events",
  url: SITE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE_URL}/search?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

// Browse data is shared and slow-moving — keep the page ISR-cached like the
// other public listings rather than hitting Mongo on every request.
export const revalidate = 60;

async function fetchCategories(): Promise<CategoryWithCount[]> {
  try {
    return await listCategoriesWithCounts();
  } catch {
    return [];
  }
}

async function fetchCircles(): Promise<FeaturedCircle[]> {
  try {
    return await listFeaturedCircles(6);
  } catch {
    return [];
  }
}

async function fetchCalendars(): Promise<FeaturedCalendar[]> {
  try {
    return await listFeaturedCalendars(6);
  } catch {
    return [];
  }
}

async function fetchCities(): Promise<CityWithCount[]> {
  try {
    return await listCitiesWithCounts(8);
  } catch {
    return [];
  }
}

/**
 * /discover — the browse surface of the NYU-24 IA: category tiles →
 * featured circles → featured calendars (NYU-25) → cities. Not a feed;
 * every card links into a scoped drill-down (/events?category=…,
 * /events?city=…, /circles/[id], /calendars/[slug]) where the timeline
 * renders. True SSR: direct Mongo reads, no HTTP hop, each section
 * degrading independently to an empty list if the cluster is unreachable.
 */
export default async function DiscoverPage() {
  const [categories, circles, calendars, cities] = await Promise.all([
    fetchCategories(),
    fetchCircles(),
    fetchCalendars(),
    fetchCities(),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <DiscoverBrowse
        categories={categories}
        circles={circles}
        calendars={calendars}
        cities={cities}
      />
    </>
  );
}
