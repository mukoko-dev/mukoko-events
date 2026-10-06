import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.fn<(id: string, referrer?: string) => Promise<void>>();
vi.mock("@/app/actions/discovery", () => ({
  trackEventViewAction: (id: string, referrer?: string) => track(id, referrer),
}));

import { EventViewTracker, __resetReferrer } from "./event-view-tracker";

beforeEach(() => {
  track.mockReset();
  track.mockResolvedValue(undefined);
  __resetReferrer();
  Object.defineProperty(document, "referrer", {
    value: "https://wa.me/123",
    configurable: true,
  });
});

describe("EventViewTracker", () => {
  it("sends the page load's referrer with the first view only", () => {
    const { rerender } = render(<EventViewTracker eventId="evt-1" />);
    rerender(<EventViewTracker eventId="evt-2" />);
    expect(track.mock.calls).toEqual([
      ["evt-1", "https://wa.me/123"],
      ["evt-2", undefined],
    ]);
  });

  it("never throws when recording fails", () => {
    track.mockRejectedValue(new Error("offline"));
    expect(() => render(<EventViewTracker eventId="evt-1" />)).not.toThrow();
  });
});
