/**
 * /discover browse-surface tests (NYU-24 IA refresh + NYU-25 calendars), on
 * the Mzizi Discover Standard components (#161).
 *
 * The page is a BROWSE surface: a hero with the GET search, then four bands
 * (categories → circles → calendars → cities), every chip and card a link
 * into a scoped drill-down. No feed, no timeline.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiscoverBrowse } from "./discover-browse";
import type { CategoryWithCount, CityWithCount } from "@/lib/mongo/lookups";
import type { FeaturedCircle } from "@/lib/circles";
import type { FeaturedCalendar } from "@/lib/mongo/calendars";

// The Featured-calendars CTA pulls in the create-calendar modal, whose server
// action modules (and the host-mode picker's) transitively import the
// `server-only`-guarded Mongo layer and WorkOS session helpers — stub those
// boundaries so this presentational test never loads them.
vi.mock("@/app/actions/calendars", () => ({
  createCalendarAction: vi.fn(),
  updateCalendarAction: vi.fn(),
  getMyCirclesAction: vi.fn(async () => []),
}));
vi.mock("@/app/actions/host-entities", () => ({
  getMyHostEntities: vi.fn(async () => []),
}));
// The CTA calls useAuth(), which throws outside an <AuthProvider> — this
// suite only exercises the server-rendered browse content, so stub a
// logged-out viewer (the CTA renders nothing, matching real behaviour).
vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => ({ user: null }),
}));

const categories: CategoryWithCount[] = [
  {
    id: "tech",
    name: "Tech & Innovation",
    group: "Categories",
    eventCount: 12,
  },
  { id: "music", name: "Music", group: "Categories", eventCount: 1 },
];

const circles: FeaturedCircle[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Harare Runners",
    slug: "harare-runners",
    description: "Weekly park runs and trail meets.",
    circleType: "public",
    memberCount: 48,
    postCount: 12,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "City Arts Wire",
    slug: null,
    description: "Announcements from the arts collective.",
    circleType: "broadcast",
    memberCount: 200,
    postCount: 40,
  },
];

// Circles that must never render on /discover. The read layer already drops
// them; these simulate a regression there (cast past the listable-only type).
const leakedCircles = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Founders Table",
    description: "Invite-first founder dinners.",
    circleType: "private",
    memberCount: 9,
    postCount: 3,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Hidden Council",
    description: null,
    circleType: "secret",
    memberCount: 4,
    postCount: 1,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Untyped Circle",
    description: null,
    circleType: undefined,
    memberCount: 7,
    postCount: 2,
  },
] as unknown as FeaturedCircle[];

const calendars: FeaturedCalendar[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug: "harare-live-music-abc123",
    name: "Harare Live Music",
    description: "Every gig worth catching in the capital.",
    followerCount: 132,
    eventCount: 8,
    theme: "malachite",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    slug: "founders-breakfasts-def456",
    name: "Founders Breakfasts",
    description: null,
    followerCount: 1,
    eventCount: 2,
    theme: null,
  },
];

const cities: CityWithCount[] = [
  { addressLocality: "Harare", addressCountry: "Zimbabwe", eventCount: 23 },
  { addressLocality: "Bulawayo", addressCountry: "Zimbabwe", eventCount: 1 },
];

function renderBrowse(
  overrides: Partial<React.ComponentProps<typeof DiscoverBrowse>> = {},
) {
  return render(
    <DiscoverBrowse
      categories={categories}
      circles={circles}
      calendars={calendars}
      cities={cities}
      {...overrides}
    />,
  );
}

/** A card's whole text: the card is the <li> around its title link. */
const card = (name: RegExp) =>
  screen.getByRole("link", { name }).closest("li") as HTMLElement;

describe("DiscoverBrowse", () => {
  it("renders the hero, the GET search and the four browse bands", () => {
    renderBrowse();
    expect(
      screen.getByRole("heading", { level: 1, name: "Discover" }),
    ).toBeInTheDocument();
    const search = screen.getByRole("search", { name: "Search events" });
    expect(search).toHaveAttribute("action", "/search");
    expect(search).toHaveAttribute("method", "get");
    for (const name of [
      "Browse by category",
      "Featured circles",
      "Featured calendars",
      "Explore by city",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("links category chips into the /events drill-down with live counts", () => {
    renderBrowse();
    const nav = screen.getByRole("navigation", { name: "Event categories" });
    const tile = screen.getByRole("link", { name: /^Tech & Innovation/ });
    expect(nav).toContainElement(tile);
    expect(tile).toHaveAttribute("href", "/events?category=tech");
    expect(tile).toHaveTextContent("12");
  });

  it("presents circles as communities with a circleType-appropriate join affordance", () => {
    renderBrowse();
    const runners = screen.getByRole("link", { name: "Harare Runners" });
    // A circle with a slug links to its page on circles.mukoko.com.
    expect(runners).toHaveAttribute(
      "href",
      "https://circles.mukoko.com/c/harare-runners",
    );
    expect(card(/Harare Runners/)).toHaveTextContent("Join");
    expect(card(/Harare Runners/)).toHaveTextContent("48members");
    // Without a slug, it links to its page here.
    expect(
      screen.getByRole("link", { name: "City Arts Wire" }),
    ).toHaveAttribute("href", "/circles/33333333-3333-4333-8333-333333333333");
    expect(card(/City Arts Wire/)).toHaveTextContent("Follow");
    expect(screen.queryByText("Request to join")).not.toBeInTheDocument();
    expect(card(/Harare Runners/)).not.toHaveTextContent(/follower/i);
  });

  it("never lists private, secret or untyped circles, even if the read layer leaks them", () => {
    renderBrowse({ circles: [...leakedCircles, ...circles] });
    for (const name of [/Founders Table/, /Hidden Council/, /Untyped Circle/]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
    for (const c of leakedCircles) {
      const leakedLink = screen
        .getAllByRole("link")
        .find((a) => a.getAttribute("href")?.includes(c.id));
      expect(leakedLink).toBeUndefined();
    }
    // The public and broadcast circles still render.
    expect(
      screen.getByRole("link", { name: /Harare Runners/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /City Arts Wire/ }),
    ).toBeInTheDocument();
  });

  it("shows the empty state when every circle passed in is private", () => {
    renderBrowse({ circles: leakedCircles });
    expect(screen.getByText(/No circles to feature yet/)).toBeInTheDocument();
  });

  it("presents calendars as followable event streams linking to their pages", () => {
    renderBrowse();
    expect(
      screen.getByRole("link", { name: "Harare Live Music" }),
    ).toHaveAttribute("href", "/calendars/harare-live-music-abc123");
    const row = card(/Harare Live Music/);
    expect(row).toHaveTextContent("132followers");
    expect(row).toHaveTextContent("Follow");
    expect(row).toHaveTextContent("Every gig worth catching in the capital.");
    // Singular follower form; calendars count followers, never members.
    const single = card(/Founders Breakfasts/);
    expect(single).toHaveTextContent("1follower");
    expect(single).not.toHaveTextContent(/member/i);
  });

  it("links city chips into the /events drill-down", () => {
    renderBrowse();
    const chip = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/events?city=Harare");
    expect(chip).toBeDefined();
    expect(chip).toHaveTextContent("Harare, Zimbabwe");
    expect(chip).toHaveTextContent("23");
  });

  it("has no inline styles (tokens only)", () => {
    const { container } = renderBrowse();
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("degrades each section to a friendly empty message", () => {
    renderBrowse({ categories: [], circles: [], calendars: [], cities: [] });
    expect(screen.getByText(/Categories are warming up/)).toBeInTheDocument();
    expect(screen.getByText(/No circles to feature yet/)).toBeInTheDocument();
    expect(screen.getByText(/No calendars to follow yet/)).toBeInTheDocument();
    expect(
      screen.getByText(/No cities with upcoming events yet/),
    ).toBeInTheDocument();
  });
});
