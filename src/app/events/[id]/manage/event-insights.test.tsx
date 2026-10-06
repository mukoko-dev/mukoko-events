import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { axe } from "vitest-axe";
import type { EventAnalyticsResult } from "@/app/actions/analytics";
import {
  eventAnalyticsFixture,
  insightsFixture,
} from "@/__tests__/fixtures/nyuchi-analytics";

// The tab reads the Nyuchi API through a server action; mock it so the
// component renders in jsdom with no network, session or Mongo.
const getAnalytics =
  vi.fn<(id: string, days?: number) => Promise<EventAnalyticsResult>>();
vi.mock("@/app/actions/analytics", () => ({
  getEventAnalyticsAction: (id: string, days?: number) =>
    getAnalytics(id, days),
}));

import {
  EventInsights,
  formatMetric,
  seriesPoints,
  summariseAttendance,
} from "./event-insights";

const registrations = [
  { status: "approved" },
  { status: "registered" },
  { status: "pending" },
  { status: "rejected" },
  { status: "attended", checkedIn: true },
  { status: "attended", checkedIn: true },
];

const ok = (): EventAnalyticsResult => ({
  status: "ok",
  analytics: eventAnalyticsFixture(),
  insights: insightsFixture(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("summariseAttendance", () => {
  it("counts each state once and rates check-ins against confirmed guests", () => {
    expect(summariseAttendance(registrations)).toEqual({
      rsvps: 6,
      approved: 2,
      pending: 1,
      checkedIn: 2,
      checkinRate: 50,
    });
  });

  it("has no check-in rate when nobody is confirmed", () => {
    expect(summariseAttendance([{ status: "pending" }]).checkinRate).toBeNull();
    expect(summariseAttendance([]).checkinRate).toBeNull();
  });
});

describe("formatMetric and seriesPoints", () => {
  it("reads a suppressed cell as 'Fewer than 5' and a missing one as not available", () => {
    expect(formatMetric({ value: 1234, suppressed: false })).toBe("1,234");
    expect(formatMetric({ value: null, suppressed: true })).toBe(
      "Fewer than 5",
    );
    expect(formatMetric(undefined)).toBe("Not available yet");
  });

  it("charts a suppressed day as null, never 0", () => {
    const points = seriesPoints(eventAnalyticsFixture().series, "views");
    expect(points.map((p) => p.value)).toEqual([60, null, 74]);
    expect(points[0].label).toBe("4 Oct");
  });
});

function valueOf(label: string): string | null | undefined {
  const card = screen
    .getByText(label, { selector: '[data-slot="stats-card-label"]' })
    .closest('[data-slot="stats-card"]');
  return card?.querySelector('[data-slot="stats-card-value"]')?.textContent;
}

describe("EventInsights", () => {
  it("shows attendance, the API's views, the series, breakdowns and insights", async () => {
    getAnalytics.mockResolvedValue(ok());
    render(<EventInsights eventId="evt-1" registrations={registrations} />);

    expect(valueOf("RSVPs")).toBe("6");
    expect(valueOf("Check-in rate")).toBe("50%");
    await waitFor(() => expect(valueOf("Page views")).toBe("137"));
    expect(getAnalytics).toHaveBeenCalledWith("evt-1", 30);

    // The figures tables carry the suppressed cells as "Fewer than 5".
    const views = screen.getByRole("figure", { name: "Page views" });
    expect(views).toHaveTextContent("Fewer than 5");
    expect(views).toHaveTextContent("At least 134");
    const cities = screen.getByRole("figure", { name: "Cities" });
    expect(cities).toHaveTextContent("Harare");
    expect(cities).toHaveTextContent("Fewer than 5");
    // A breakdown the platform can't give yet says so.
    expect(
      screen.getByTestId("insights-sources-not-available"),
    ).toHaveTextContent(/not available yet/i);
    expect(screen.getByText("Views are climbing")).toBeInTheDocument();
  });

  it("says 'not available yet' for a series or breakdown with no data, never 'Fewer than 5'", async () => {
    const noData = { value: null, suppressed: false };
    const analytics = eventAnalyticsFixture({ unavailable: ["series.views"] });
    analytics.series = analytics.series.map((d) => ({ ...d, views: noData }));
    analytics.breakdowns.localities.items = [{ name: "Harare", views: noData }];
    getAnalytics.mockResolvedValue({ status: "ok", analytics, insights: null });
    render(<EventInsights eventId="evt-1" registrations={registrations} />);
    expect(
      await screen.findByTestId("insights-views-not-available"),
    ).toHaveTextContent(/not available yet/i);
    expect(
      screen.getByTestId("insights-localities-not-available"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("figure", { name: "Page views" })).toBeNull();
    // The RSVP series has real and suppressed days, so it still charts.
    expect(screen.getByRole("figure", { name: "RSVPs" })).toBeInTheDocument();
  });

  it("changes the window with a working control", async () => {
    getAnalytics.mockResolvedValue(ok());
    render(<EventInsights eventId="evt-1" registrations={registrations} />);
    const seven = await screen.findByRole("radio", { name: "7 days" });
    fireEvent.click(seven);
    await waitFor(() =>
      expect(getAnalytics).toHaveBeenLastCalledWith("evt-1", 7),
    );
  });

  it.each([
    ["unavailable", { status: "unavailable" } as EventAnalyticsResult],
    [
      "available: false",
      {
        status: "ok",
        analytics: eventAnalyticsFixture({ available: false }),
        insights: null,
      } as EventAnalyticsResult,
    ],
  ])(
    "says 'not available yet' when the API is %s, never 0",
    async (_, result) => {
      getAnalytics.mockResolvedValue(result);
      render(<EventInsights eventId="evt-1" registrations={[]} />);
      await waitFor(() =>
        expect(screen.getByTestId("insights-not-available")).toHaveTextContent(
          /page-view history and traffic sources arrive with the new analytics platform/i,
        ),
      );
      expect(valueOf("Page views")).toBe("Not available yet");
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.queryByText(/past 7 days/i)).toBeNull();
    },
  );

  it("survives a failed action call", async () => {
    getAnalytics.mockRejectedValue(new Error("network"));
    render(<EventInsights eventId="evt-1" registrations={registrations} />);
    await waitFor(() =>
      expect(valueOf("Page views")).toBe("Not available yet"),
    );
  });

  it("has no accessibility violations with data", async () => {
    getAnalytics.mockResolvedValue(ok());
    const { container } = render(
      <EventInsights eventId="evt-1" registrations={registrations} />,
    );
    await waitFor(() => expect(valueOf("Page views")).toBe("137"));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations when not available", async () => {
    getAnalytics.mockResolvedValue({ status: "unavailable" });
    const { container } = render(
      <EventInsights eventId="evt-1" registrations={registrations} />,
    );
    await screen.findByTestId("insights-not-available");
    expect(await axe(container)).toHaveNoViolations();
  });
});
