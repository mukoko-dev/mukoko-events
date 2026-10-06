"use client";

/**
 * The organiser Insights tab on /events/[id]/manage.
 *
 * Attendance (RSVPs, approved, pending, checked in, check-in rate) comes from
 * the registrations the manage page already loaded (host-gated). Views, the
 * daily series, localities, sources and the one-line insights come from the
 * Nyuchi API (`getEventAnalyticsAction`, nyuchi/api-gateway#268).
 *
 * Honest numbers only: a k-suppressed cell reads "Fewer than 5", a response
 * or breakdown with `available: false` reads "Not available yet", and when the
 * API is not configured or fails the whole analytics part says so. Nothing is
 * ever shown as a made-up 0.
 */

import { useEffect, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Eye,
  Lightbulb,
  Users,
} from "lucide-react";
import {
  getEventAnalyticsAction,
  type EventAnalyticsResult,
} from "@/app/actions/analytics";
import type {
  Breakdown,
  EventAnalytics,
  Insights,
  Metric,
} from "@/lib/nyuchi-api/analytics";
import { BarChart, type BarChartPoint } from "@/components/ui/app-bar-chart";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
const FEWER_THAN_K = "Fewer than 5";
const NOT_AVAILABLE = "Not available yet";
const WINDOWS = [7, 30, 90] as const;

/** A metric as text: the number, "Fewer than 5" when suppressed, else "Not available yet". */
export function formatMetric(metric: Metric | null | undefined): string {
  if (metric?.suppressed) return FEWER_THAN_K;
  if (typeof metric?.value === "number")
    return numberFormat.format(metric.value);
  return NOT_AVAILABLE;
}

/** A real figure or a suppressed one: anything else is "no data", not "fewer than 5". */
function hasFigure(metric: Metric | null | undefined): boolean {
  return Boolean(metric?.suppressed || typeof metric?.value === "number");
}

/**
 * Can this daily series be charted? Not when the API lists it as unavailable
 * or any day has no data (`{value: null, suppressed: false}`): charting those
 * days as "Fewer than 5" would be a made-up figure.
 */
export function seriesHasFigures(
  analytics: EventAnalytics,
  pick: "views" | "rsvps" | "checkins",
): boolean {
  if (analytics.unavailable?.includes(`series.${pick}`)) return false;
  return analytics.series.every((day) => hasFigure(day[pick]));
}

/** A metric as a chart value: null (no bar, never 0) when suppressed or missing. */
function chartValue(metric: Metric | null | undefined): number | null {
  if (!metric || metric.suppressed || typeof metric.value !== "number")
    return null;
  return metric.value;
}

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dayLong = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** `series[].date` is ISO `YYYY-MM-DD`, UTC, oldest first. */
export function seriesPoints(
  series: EventAnalytics["series"],
  pick: "views" | "rsvps" | "checkins",
): BarChartPoint[] {
  return series.map((day) => {
    const date = new Date(`${day.date}T00:00:00Z`);
    const valid = !Number.isNaN(date.getTime());
    return {
      label: valid ? dayLabel.format(date) : day.date,
      long: valid ? dayLong.format(date) : day.date,
      value: chartValue(day[pick]),
    };
  });
}

function NotAvailable({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Empty data-testid={testId}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BarChart3 aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{NOT_AVAILABLE}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function BreakdownCard({
  id,
  title,
  description,
  breakdown,
  windowDays,
  labelHeading,
}: {
  id: string;
  title: string;
  description: string;
  breakdown: Breakdown;
  windowDays: number;
  labelHeading: string;
}) {
  if (
    !breakdown.available ||
    !breakdown.items.every((i) => hasFigure(i.views))
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotAvailable testId={`${id}-not-available`}>
            {title} arrive with the new analytics platform.
          </NotAvailable>
        </CardContent>
      </Card>
    );
  }
  return (
    <BarChart
      id={id}
      title={title}
      caption={`Page views, last ${windowDays} days`}
      layout="rows"
      labelHeading={labelHeading}
      valueLabel="Views"
      missingLabel={FEWER_THAN_K}
      data={breakdown.items.map((item) => ({
        label: item.name,
        value: chartValue(item.views),
      }))}
    />
  );
}

function SeriesChart({
  id,
  title,
  analytics,
  pick,
  valueLabel,
}: {
  id: string;
  title: string;
  analytics: EventAnalytics;
  pick: "views" | "rsvps";
  valueLabel: string;
}) {
  if (!seriesHasFigures(analytics, pick)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Per day</CardDescription>
        </CardHeader>
        <CardContent>
          <NotAvailable testId={`${id}-not-available`}>
            Daily {title.toLowerCase()} arrive with the new analytics platform.
          </NotAvailable>
        </CardContent>
      </Card>
    );
  }
  return (
    <BarChart
      id={id}
      title={title}
      caption={`Per day, last ${analytics.window.days} days`}
      labelHeading="Day"
      valueLabel={valueLabel}
      missingLabel={FEWER_THAN_K}
      data={seriesPoints(analytics.series, pick)}
    />
  );
}

function InsightList({ insights }: { insights: Insights }) {
  if (!insights.available || insights.items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="size-4" aria-hidden="true" />
          What stands out
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {insights.items.map((item, i) => (
            <li key={`${item.kind}-${i}`}>
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-text-secondary">{item.text}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function EventInsights({
  eventId,
  registrations,
}: {
  eventId: string;
  registrations: readonly InsightsRegistration[];
}) {
  const summary = summariseAttendance(registrations);
  const [days, setDays] = useState<number>(30);
  // The last answer stays on screen while a new window loads, so the window
  // control keeps its place and focus.
  const [result, setResult] = useState<EventAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getEventAnalyticsAction(eventId, days)
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch(() => {
        if (!cancelled) setResult({ status: "unavailable" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, days]);

  const analytics =
    result?.status === "ok" && result.analytics.available
      ? result.analytics
      : null;
  const insights = result?.status === "ok" ? result.insights : null;
  const viewsValue = !result
    ? "…"
    : analytics
      ? formatMetric(analytics.totals.views)
      : NOT_AVAILABLE;

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
          event page&apos;s all-time total; the charts below follow the chosen
          window.
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
          <div aria-live="polite" aria-busy={loading}>
            <StatsCard
              label="Page views"
              value={viewsValue}
              icon={<Eye aria-hidden="true" />}
            />
          </div>
        </div>
      </section>

      {analytics ? (
        <section
          aria-labelledby="insights-traffic-heading"
          aria-busy={loading}
          className="space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="insights-traffic-heading" className="text-lg font-semibold">
              Page views and sources
            </h2>
            <ToggleGroup
              type="single"
              variant="outline"
              value={String(days)}
              onValueChange={(v) => {
                if (v) setDays(Number(v));
              }}
              aria-label="Time window"
            >
              {WINDOWS.map((w) => (
                <ToggleGroupItem
                  key={w}
                  value={String(w)}
                  className="min-h-11 px-3"
                >
                  {w} days
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p className="text-sm text-text-secondary">
            A day or place with fewer than 5 people reads &ldquo;Fewer than
            5&rdquo; to protect privacy. It is never counted as 0.
          </p>
          <SeriesChart
            id="insights-views"
            title="Page views"
            analytics={analytics}
            pick="views"
            valueLabel="Views"
          />
          <SeriesChart
            id="insights-rsvps"
            title="RSVPs"
            analytics={analytics}
            pick="rsvps"
            valueLabel="RSVPs"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownCard
              id="insights-sources"
              title="Traffic sources"
              description="The sites visitors came from."
              breakdown={analytics.breakdowns.sources}
              windowDays={analytics.window.days}
              labelHeading="Source"
            />
            <BreakdownCard
              id="insights-localities"
              title="Cities"
              description="Where visitors are."
              breakdown={analytics.breakdowns.localities}
              windowDays={analytics.window.days}
              labelHeading="City"
            />
          </div>
          {insights && <InsightList insights={insights} />}
        </section>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Page views over time and traffic sources</CardTitle>
            <CardDescription>
              Daily views, where visitors come from and which cities they are
              in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="py-8 text-center text-sm text-text-secondary">
                Loading analytics…
              </p>
            ) : (
              <NotAvailable testId="insights-not-available">
                Page-view history and traffic sources arrive with the new
                analytics platform. Until then, the attendance figures above are
                the ones we hold.
              </NotAvailable>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
