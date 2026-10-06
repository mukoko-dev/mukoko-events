"use client";

/**
 * The organiser Insights tab on /events/[id]/manage.
 *
 * Honest numbers only: the RSVP, approval, pending and check-in counts come
 * from the registrations the manage page already loaded (host-gated), and the
 * lifetime view total from the host-gated `getEventViewTotalAction`. Page-view
 * history and traffic sources have no backend yet, so they say so plainly
 * instead of showing empty charts or made-up figures (nyuchi/api-gateway#268).
 */

import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2, Clock, Eye, Users } from "lucide-react";
import { getEventViewTotalAction } from "@/app/actions/host-registrations";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { StatsCard } from "@/components/ui/stats-card";

export interface InsightsRegistration {
  status: string;
  checkedIn?: boolean;
}

export interface AttendanceSummary {
  /** Every registration the host can see, whatever its state. */
  rsvps: number;
  /** Confirmed guests: approved or registered (not yet checked in). */
  approved: number;
  /** Awaiting the host's approval. */
  pending: number;
  /** Checked in at the door. */
  checkedIn: number;
  /** Checked in ÷ confirmed guests (approved + checked in), 0–100; null when nobody is confirmed. */
  checkinRate: number | null;
}

/** Count the registrations the manage page holds. Pure, so it is tested directly. */
export function summariseAttendance(
  registrations: readonly InsightsRegistration[],
): AttendanceSummary {
  let approved = 0;
  let pending = 0;
  let checkedIn = 0;
  for (const r of registrations) {
    if (r.checkedIn) checkedIn += 1;
    else if (r.status === "approved" || r.status === "registered")
      approved += 1;
    else if (r.status === "pending") pending += 1;
  }
  const confirmed = approved + checkedIn;
  return {
    rsvps: registrations.length,
    approved,
    pending,
    checkedIn,
    checkinRate:
      confirmed > 0 ? Math.round((checkedIn / confirmed) * 100) : null,
  };
}

const numberFormat = new Intl.NumberFormat("en-GB");

type ViewsState =
  | { kind: "loading" }
  | { kind: "ready"; views: number }
  | { kind: "unavailable" };

export function EventInsights({
  eventId,
  registrations,
}: {
  eventId: string;
  registrations: readonly InsightsRegistration[];
}) {
  const summary = summariseAttendance(registrations);
  const [views, setViews] = useState<ViewsState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    getEventViewTotalAction(eventId)
      .then((res) => {
        if (!cancelled) setViews({ kind: "ready", views: res.views });
      })
      .catch(() => {
        if (!cancelled) setViews({ kind: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const viewsValue =
    views.kind === "ready"
      ? numberFormat.format(views.views)
      : views.kind === "loading"
        ? "…"
        : "Not available";

  return (
    <div className="space-y-6">
      <section aria-labelledby="insights-attendance-heading">
        <h2
          id="insights-attendance-heading"
          className="mb-1 text-lg font-semibold"
        >
          Attendance
        </h2>
        <p className="mb-3 text-sm text-text-secondary">
          Approved counts confirmed guests not yet checked in. The check-in rate
          is guests checked in out of all confirmed guests. Page views are the
          all-time total for the event page.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatsCard
            label="RSVPs"
            value={numberFormat.format(summary.rsvps)}
            icon={<Users aria-hidden="true" />}
          />
          <StatsCard
            label="Approved"
            value={numberFormat.format(summary.approved)}
            icon={<CheckCircle2 aria-hidden="true" />}
          />
          <StatsCard
            label="Pending"
            value={numberFormat.format(summary.pending)}
            icon={<Clock aria-hidden="true" />}
          />
          <StatsCard
            label="Checked in"
            value={numberFormat.format(summary.checkedIn)}
            icon={<CheckCircle2 aria-hidden="true" />}
          />
          <StatsCard
            label="Check-in rate"
            value={
              summary.checkinRate === null ? "—" : `${summary.checkinRate}%`
            }
            icon={<BarChart3 aria-hidden="true" />}
          />
          <div aria-live="polite" aria-busy={views.kind === "loading"}>
            <StatsCard
              label="Page views"
              value={viewsValue}
              icon={<Eye aria-hidden="true" />}
            />
          </div>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Page views over time and traffic sources</CardTitle>
          <CardDescription>
            Daily views, where visitors come from and which cities they are in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty data-testid="insights-not-available">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Not available yet</EmptyTitle>
              <EmptyDescription>
                Page-view history and traffic sources arrive with the new
                analytics platform. Until then, the totals above are the figures
                we hold.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
