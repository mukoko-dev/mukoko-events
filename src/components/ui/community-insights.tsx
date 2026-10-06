"use client";

/**
 * Community insights: what is happening across Mukoko Events, from the Nyuchi
 * API's public community analytics (`getCommunityStatsAction`).
 *
 * Every count is k-anonymised on the platform: a count below 5 arrives as
 * null and reads "Fewer than 5". When the platform has no figures yet
 * (`available: false`), the widget says "not available yet". Nothing is ever
 * shown as a made-up 0 or a made-up percentage.
 */

import { useState, useEffect } from "react";
import { TrendingUp, Users, MapPin, Clock, Flame, Loader2 } from "lucide-react";
import { StatsCard } from "@/components/ui/stats-card";
import { Badge } from "@/components/ui/badge";
import { type CommunityStats } from "@/lib/api";
import { getCommunityStatsAction } from "@/app/actions/discovery";

const FEWER_THAN_K = "Fewer than 5";
const numberFormat = new Intl.NumberFormat("en-GB");

/** A k-suppressed count as text: the number, or "Fewer than 5" when withheld. */
export function formatCount(value: number | null): string {
  return value === null ? FEWER_THAN_K : numberFormat.format(value);
}

function eventsLabel(value: number | null): string {
  if (value === null) return `${FEWER_THAN_K} events`;
  return `${numberFormat.format(value)} ${value === 1 ? "event" : "events"}`;
}

function Change({ change }: { change: number | null }) {
  if (change === null) return null;
  const colour =
    change > 0
      ? "text-green-400"
      : change < 0
        ? "text-red-400"
        : "text-text-tertiary";
  const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
  const words =
    change > 0
      ? `up ${Math.abs(change)}%`
      : change < 0
        ? `down ${Math.abs(change)}%`
        : "no change";
  return (
    <span className={`text-sm font-semibold flex items-center gap-1 ${colour}`}>
      <span aria-hidden="true">{arrow}</span>
      <span className="sr-only">{words}</span>
      <span aria-hidden="true">{Math.abs(change)}%</span>
    </span>
  );
}

function useCommunityStats(city?: string) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CommunityStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCommunityStatsAction(city)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [city]);

  return { loading, stats };
}

interface CommunityInsightsProps {
  city?: string;
  className?: string;
}

export function CommunityInsights({
  city,
  className = "",
}: CommunityInsightsProps) {
  const { loading, stats } = useCommunityStats(city);

  const header = (
    <div className="flex items-center gap-2 mb-6">
      <TrendingUp className="w-5 h-5 text-primary" aria-hidden="true" />
      <h3 className="font-bold text-lg">Community Insights</h3>
      {city && (
        <span className="text-sm text-text-secondary ml-auto">in {city}</span>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className={`bg-surface rounded-2xl p-6 ${className}`}>
        {header}
        <div className="flex items-center justify-center py-12">
          <Loader2
            className="w-6 h-6 animate-spin text-primary"
            aria-hidden="true"
          />
          <span className="sr-only">Loading community insights</span>
        </div>
      </div>
    );
  }

  if (!stats?.available) {
    return (
      <div className={`bg-surface rounded-2xl p-6 ${className}`}>
        {header}
        <p className="text-sm text-text-secondary">
          Not available yet: community insights arrive with the new analytics
          platform.
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-surface rounded-2xl p-6 ${className}`}>
      {header}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatsCard
          label="Events"
          value={formatCount(stats.totalEvents)}
          icon={<Flame className="w-4 h-4" aria-hidden="true" />}
          className="bg-elevated border-0"
        />
        <StatsCard
          label="Attendees"
          value={formatCount(stats.totalAttendees)}
          icon={<Users className="w-4 h-4" aria-hidden="true" />}
          className="bg-elevated border-0"
        />
      </div>

      {stats.trendingCategories.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-2">
            <Flame className="w-4 h-4" aria-hidden="true" />
            Trending Categories
          </h4>
          <ul className="space-y-2">
            {stats.trendingCategories.map((category) => (
              <li
                key={category.category}
                className="flex items-center justify-between py-2 px-3 bg-elevated rounded-lg"
              >
                <span className="font-medium">{category.category}</span>
                <span className="flex items-center gap-3">
                  <span className="text-sm text-text-secondary">
                    {eventsLabel(category.events)}
                  </span>
                  <Change change={category.change} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.peakTime && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" aria-hidden="true" />
            Peak Event Time
          </h4>
          <p className="text-sm font-medium">{stats.peakTime}</p>
        </div>
      )}

      {stats.popularVenues.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4" aria-hidden="true" />
            Popular Venues
          </h4>
          <ol className="space-y-2">
            {stats.popularVenues.slice(0, 3).map((venue, i) => (
              <li
                key={`${venue.venue}-${i}`}
                className="flex items-center justify-between py-2 px-3 bg-elevated rounded-lg"
              >
                <span className="flex items-center gap-2">
                  <Badge
                    variant="default"
                    className="w-5 h-5 flex items-center justify-center text-xs font-bold"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </Badge>
                  <span className="font-medium text-sm">{venue.venue}</span>
                </span>
                <span className="text-sm text-text-secondary">
                  {eventsLabel(venue.events)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// Compact version for sidebars
export function CommunityInsightsCompact({
  city,
  className = "",
}: {
  city?: string;
  className?: string;
}) {
  const { loading, stats } = useCommunityStats(city);

  const header = (
    <div className="flex items-center gap-2 mb-4">
      <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
      <span className="font-semibold text-sm">What&apos;s Trending</span>
    </div>
  );

  if (loading) {
    return (
      <div className={`bg-surface rounded-xl p-4 ${className}`}>
        {header}
        <div className="flex items-center justify-center py-4">
          <Loader2
            className="w-4 h-4 animate-spin text-primary"
            aria-hidden="true"
          />
          <span className="sr-only">Loading what&apos;s trending</span>
        </div>
      </div>
    );
  }

  const topCategory = stats?.trendingCategories[0];
  const topVenue = stats?.popularVenues[0];

  if (!stats?.available || (!topCategory && !topVenue && !stats.peakTime)) {
    return (
      <div className={`bg-surface rounded-xl p-4 ${className}`}>
        {header}
        <p className="text-sm text-text-secondary">Not available yet.</p>
      </div>
    );
  }

  return (
    <div className={`bg-surface rounded-xl p-4 ${className}`}>
      {header}
      <div className="space-y-3">
        {topCategory && (
          <div className="flex items-center justify-between">
            <span className="text-sm">{topCategory.category} events</span>
            <Change change={topCategory.change} />
          </div>
        )}
        {stats.peakTime && (
          <div className="flex items-center justify-between">
            <span className="text-sm">Peak time</span>
            <span className="text-xs text-text-secondary">
              {stats.peakTime}
            </span>
          </div>
        )}
        {topVenue && (
          <div className="flex items-center justify-between">
            <span className="text-sm">Hot venue</span>
            <span className="text-xs text-text-secondary">
              {topVenue.venue}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
