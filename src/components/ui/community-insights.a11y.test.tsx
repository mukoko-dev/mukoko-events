import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { axe } from "vitest-axe";
import type { CommunityStats } from "@/lib/api";
import {
  CommunityInsights,
  CommunityInsightsCompact,
  formatCount,
} from "./community-insights";

const mockGetCommunityStats = vi.fn();

// community-insights reads through the discovery server action (which calls
// the Nyuchi API), so mock that — importing the real action would pull in
// `server-only` and blow up in jsdom.
vi.mock("@/app/actions/discovery", () => ({
  getCommunityStatsAction: (...args: unknown[]) =>
    mockGetCommunityStats(...args),
}));

const stats: CommunityStats = {
  addressLocality: "Harare",
  available: true,
  totalEvents: 42,
  totalAttendees: null,
  activeHosts: 7,
  trendingCategories: [
    { category: "Music", change: 25, events: 12 },
    { category: "Tech", change: null, events: null },
  ],
  popularVenues: [
    { venue: "Harare Gardens", events: 5 },
    { venue: "Eastgate", events: null },
  ],
  peakTime: "Friday 18:00",
};

describe("CommunityInsights", () => {
  beforeEach(() => {
    mockGetCommunityStats.mockReset();
    mockGetCommunityStats.mockResolvedValue(stats);
  });

  it("shows a suppressed count as 'Fewer than 5', never 0", async () => {
    render(<CommunityInsights city="Harare" />);
    await screen.findByText("Harare Gardens");
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getAllByText("Fewer than 5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fewer than 5 events").length).toBe(2);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText("Friday 18:00")).toBeInTheDocument();
    expect(formatCount(null)).toBe("Fewer than 5");
  });

  it("says 'not available yet' when the platform has no figures", async () => {
    mockGetCommunityStats.mockResolvedValue({
      ...stats,
      available: false,
      totalEvents: null,
      trendingCategories: [],
      popularVenues: [],
      peakTime: null,
    });
    render(<CommunityInsights />);
    await screen.findByText(/not available yet/i);
  });

  it("full version has no a11y violations after data loads", async () => {
    const { container } = render(<CommunityInsights city="Harare" />);
    await screen.findByText("Harare Gardens");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("compact version has no a11y violations after data loads", async () => {
    const { container, queryByText } = render(
      <CommunityInsightsCompact city="Harare" />,
    );
    await waitFor(() => {
      expect(queryByText("Hot venue")).toBeInTheDocument();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
