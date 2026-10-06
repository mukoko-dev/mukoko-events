import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { axe } from "vitest-axe";

// The tab reads the view total through a host-gated server action; mock it so
// the component renders in jsdom without Mongo or a session.
const getEventViewTotal = vi.fn<(id: string) => Promise<{ views: number }>>();
vi.mock("@/app/actions/host-registrations", () => ({
  getEventViewTotalAction: (id: string) => getEventViewTotal(id),
}));

import { EventInsights, summariseAttendance } from "./event-insights";

const registrations = [
  { status: "approved" },
  { status: "registered" },
  { status: "pending" },
  { status: "rejected" },
  { status: "attended", checkedIn: true },
  { status: "attended", checkedIn: true },
];

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
    expect(summariseAttendance([{ status: "pending" }])).toMatchObject({
      rsvps: 1,
      checkinRate: null,
    });
    expect(summariseAttendance([]).checkinRate).toBeNull();
  });
});

function valueOf(label: string): string | null | undefined {
  const card = screen.getByText(label).closest('[data-slot="stats-card"]');
  return card?.querySelector('[data-slot="stats-card-value"]')?.textContent;
}

describe("EventInsights", () => {
  it("shows the real counts and the lifetime view total", async () => {
    getEventViewTotal.mockResolvedValue({ views: 1234 });
    render(<EventInsights eventId="evt-1" registrations={registrations} />);

    expect(valueOf("RSVPs")).toBe("6");
    expect(valueOf("Approved")).toBe("2");
    expect(valueOf("Pending")).toBe("1");
    expect(valueOf("Checked in")).toBe("2");
    expect(valueOf("Check-in rate")).toBe("50%");
    await waitFor(() => expect(valueOf("Page views")).toBe("1,234"));
    expect(getEventViewTotal).toHaveBeenCalledWith("evt-1");
  });

  it("says the view total is not available when the read fails, never 0", async () => {
    getEventViewTotal.mockRejectedValue(new Error("Not authorized"));
    render(<EventInsights eventId="evt-1" registrations={[]} />);
    await waitFor(() => expect(valueOf("Page views")).toBe("Not available"));
    expect(valueOf("Check-in rate")).toBe("—");
  });

  it("states that history and sources are not available yet, with no dead controls", async () => {
    getEventViewTotal.mockResolvedValue({ views: 0 });
    render(<EventInsights eventId="evt-1" registrations={registrations} />);
    expect(screen.getByTestId("insights-not-available")).toHaveTextContent(
      /page-view history and traffic sources arrive with the new analytics platform/i,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/past 7 days/i)).toBeNull();
    await waitFor(() => expect(valueOf("Page views")).toBe("0"));
  });

  it("has no accessibility violations", async () => {
    getEventViewTotal.mockResolvedValue({ views: 12 });
    const { container } = render(
      <EventInsights eventId="evt-1" registrations={registrations} />,
    );
    await waitFor(() => expect(valueOf("Page views")).toBe("12"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
