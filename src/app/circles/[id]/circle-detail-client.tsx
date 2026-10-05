"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CalendarRange,
  Heart,
  MessageCircle,
  Users,
  Flame,
  Archive,
  Lock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { NyuchiContentComposer } from "@/components/ui/nyuchi-content-composer";
import {
  NyuchiTimeline,
  type TimelineItem,
} from "@/components/ui/nyuchi-timeline";
import { categoryToMineral } from "@/lib/category-mineral";
import { getTheme } from "@/lib/themes";
import { getMediaUrl, type Event } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/auth/auth-context";
import {
  createCirclePost,
  getCircle,
  getCircleCalendars,
  getCircleEvents,
  getCircleMembers,
  getCirclePosts,
  joinCircle,
  togglePostReaction,
  type CircleCalendarSummary,
  type CircleDetail,
  type CircleMember,
  type CirclePerson,
  type CirclePost,
  type CircleViewer,
} from "@/app/actions/circle-detail";
import { AttachCalendar } from "./attach-calendar";
import { CircleDiscuss } from "./circle-discuss";
import { useT } from "@/lib/i18n";

interface CircleDetailClientProps {
  circleId: string;
  /**
   * The circle as the server resolved it for this viewer, with their
   * permission flags. The page 404s before rendering this for a circle the
   * viewer may not see; the actions re-check every read and write.
   */
  initialCircle: CircleDetail;
}

type CircleTab = "events" | "stream" | "members" | "calendars" | "archive";

const JOIN_LABELS: Record<
  Exclude<CircleViewer["join"], null>,
  string | null
> = {
  join: null, // the translated "Join" label
  follow: "Follow",
  request: "Request to join",
  requested: "Request sent",
  accept_invite: "Accept invitation",
};

function authorLabel(p: CirclePerson | null): string {
  if (!p) return "Member";
  return (
    p.name || [p.givenname, p.familyname].filter(Boolean).join(" ") || "Member"
  );
}

function authorInitial(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || "•";
}

export default function CircleDetailClient({
  circleId,
  initialCircle,
}: CircleDetailClientProps) {
  const { t } = useT();
  const { user, isAuthenticated } = useAuth();
  const personId = user?.personId ?? null;

  const [loading, setLoading] = useState(true);
  const [circle, setCircle] = useState<CircleDetail | null>(initialCircle);
  const [events, setEvents] = useState<Event[]>([]);
  const [posts, setPosts] = useState<CirclePost[]>([]);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [calendars, setCalendars] = useState<CircleCalendarSummary[]>([]);
  const [archived, setArchived] = useState<CirclePost[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewer = circle?.viewer ?? initialCircle.viewer;
  const [tab, setTab] = useState<CircleTab>(
    viewer.canSeeEvents ? "events" : "stream",
  );

  const isMember = viewer.isMember;
  const isOwner = viewer.isOwner;
  const isPreview = viewer.access === "preview";

  const refetchCalendars = useCallback(() => {
    getCircleCalendars(circleId).then(setCalendars);
  }, [circleId]);

  // Fetch what this viewer may see once per circleId (and again after a
  // join changes their access). The server actions enforce the same rules
  // and return empty for anything not permitted; skipping the calls here only
  // saves round trips. Setting state happens only inside the promise
  // resolution, never synchronously in the effect body — required by the
  // React 19 `set-state-in-effect` rule.
  const [accessVersion, setAccessVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const none = <T,>(): Promise<T[]> => Promise.resolve([]);
    Promise.all([
      accessVersion > 0 ? getCircle(circleId) : Promise.resolve(initialCircle),
      viewer.canSeeEvents ? getCircleEvents(circleId, 50) : none<Event>(),
      viewer.canReadPosts
        ? getCirclePosts(circleId, 30, false)
        : none<CirclePost>(),
      viewer.canSeeMembers
        ? getCircleMembers(circleId, 100)
        : none<CircleMember>(),
      viewer.canSeeEvents
        ? getCircleCalendars(circleId)
        : none<CircleCalendarSummary>(),
    ])
      .then(([c, ev, p, m, cal]) => {
        if (cancelled) return;
        setCircle(c);
        setEvents(ev);
        setPosts(p);
        setMembers(m);
        setCalendars(cal);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Failed to load this circle",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `viewer` flags are derived from `circle`, which only changes through
    // `accessVersion` — re-running on them would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, accessVersion]);

  const loadArchive = useCallback(async () => {
    if (archived.length > 0 || !viewer.canSeeArchive) return;
    try {
      const a = await getCirclePosts(circleId, 30, true);
      setArchived(a);
    } catch {
      // Silent — archive is best-effort.
    }
  }, [archived.length, circleId, viewer.canSeeArchive]);

  // Lazy-load the archive on tab change. We invoke from the tab handler
  // rather than a useEffect-on-tab so we don't trigger setState in an
  // effect body when nothing has actually changed.
  const onTabChange = (next: CircleTab) => {
    setTab(next);
    if (next === "archive") void loadArchive();
  };

  const handlePost = async (text: string) => {
    const body = text.trim();
    if (!personId || !body || !viewer.canPost) return;
    setSubmitting(true);
    setError(null);
    try {
      const newPost = await createCirclePost({
        circleId,
        text: body,
      });
      // Optimistic — backfill author from current user
      const me = members.find((m) => m.person_id === personId)?.person ?? {
        id: personId,
        name: user?.name ?? null,
        givenname: null,
        familyname: null,
        image: null,
      };
      setPosts((prev) => [{ ...newPost, author: me }, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post");
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async () => {
    if (!personId || !viewer.join || viewer.join === "requested") return;
    setSubmitting(true);
    setError(null);
    try {
      await joinCircle({ circleId });
      // Re-resolve access on the server: the join (or the pending request)
      // changes what this viewer may see.
      setAccessVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join circle");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReaction = async (postId: string) => {
    if (!personId || !viewer.canReact) return;
    try {
      const result = await togglePostReaction({ postId });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                like_count: (p.like_count ?? 0) + (result === "added" ? 1 : -1),
              }
            : p,
        ),
      );
    } catch (e) {
      console.warn("[mukoko] circle reaction failed", e);
      setError("Couldn't save your reaction. Tap again to retry.");
    }
  };

  return (
    <div className="max-w-300 mx-auto px-6 py-6">
      <Link
        href="/circles"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden />
        All circles
      </Link>

      {!circle ? (
        <Card className="border-0 bg-surface">
          <CardContent className="p-8 text-center">
            <p className="text-text-secondary">
              This circle isn&apos;t available, or you don&apos;t have access to
              it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Savanna hero */}
          <header className="relative overflow-hidden rounded-(--radius-card) p-8 md:p-10 mb-6">
            <div
              aria-hidden
              className="absolute inset-0 -z-10"
              style={{
                backgroundImage:
                  "radial-gradient(700px 350px at 0% 100%, color-mix(in srgb, var(--heritage-savanna) 50%, transparent) 0%, transparent 60%), radial-gradient(600px 300px at 100% 0%, color-mix(in srgb, var(--heritage-baobab) 40%, transparent) 0%, transparent 60%), var(--surface)",
              }}
            />
            <div className="flex items-start gap-5">
              <div
                className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center text-primary-foreground font-bold text-2xl"
                style={{
                  background:
                    "linear-gradient(135deg, var(--heritage-savanna), var(--heritage-baobab))",
                }}
                aria-hidden
              >
                {authorInitial(circle.name)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-1">
                  {circle.name}
                </h1>
                <p className="text-text-secondary mb-3">
                  {circle.description || circle.circle_purpose}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-sm text-text-tertiary">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-4 h-4" aria-hidden />
                    {circle.member_count ?? members.length} members
                  </span>
                  {circle.linked_event_id && (
                    <span className="inline-flex items-center gap-1.5">
                      <Flame className="w-4 h-4" aria-hidden />
                      Event circle
                    </span>
                  )}
                </div>
              </div>

              {isAuthenticated && !isMember && viewer.join && (
                <Button
                  onClick={handleJoin}
                  disabled={submitting || viewer.join === "requested"}
                  className="rounded-full"
                >
                  {JOIN_LABELS[viewer.join] ?? t("circle.join")}
                </Button>
              )}
            </div>
          </header>

          {error && (
            <div
              className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400"
              role="alert"
            >
              {error}
            </div>
          )}

          {isPreview ? (
            <Card className="border-0 bg-surface">
              <CardContent className="p-8 text-center text-text-secondary text-sm">
                <Lock
                  className="w-8 h-8 mx-auto mb-2 text-text-tertiary"
                  aria-hidden
                />
                {viewer.join === "accept_invite"
                  ? "You've been invited to this circle. Accept the invitation to see its posts, events and members."
                  : viewer.join === "requested"
                    ? "Your request to join is waiting for the circle's moderators."
                    : isAuthenticated
                      ? "This circle is private. Its posts, events and members are visible to members only."
                      : "This circle is private. Sign in to request to join."}
              </CardContent>
            </Card>
          ) : loading ? (
            <Skeleton className="h-48 w-full rounded-(--radius-card)" />
          ) : (
            <Tabs
              value={tab}
              onValueChange={(v) => onTabChange(v as CircleTab)}
            >
              <TabsList className="mb-4">
                {viewer.canSeeEvents && (
                  <TabsTrigger value="events">
                    {t("circle.tabs.events")}
                  </TabsTrigger>
                )}
                <TabsTrigger value="stream">
                  {t("circle.tabs.stream")}
                </TabsTrigger>
                {viewer.canSeeMembers && (
                  <TabsTrigger value="members">
                    {t("circle.tabs.members")}
                  </TabsTrigger>
                )}
                {viewer.canSeeEvents && (
                  <TabsTrigger value="calendars">Calendars</TabsTrigger>
                )}
                {viewer.canSeeArchive && (
                  <TabsTrigger value="archive">
                    {t("circle.tabs.archive")}
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="events">
                {events.length === 0 ? (
                  <Card className="border-0 bg-surface">
                    <CardContent className="p-8 text-center text-text-secondary text-sm">
                      <CalendarDays
                        className="w-8 h-8 mx-auto mb-2 text-text-tertiary"
                        aria-hidden
                      />
                      No upcoming gatherings from this circle yet.
                    </CardContent>
                  </Card>
                ) : (
                  <NyuchiTimeline
                    items={events.map((event): TimelineItem => ({
                      id: event.id,
                      date: event.startDate,
                      time: event.date.time,
                      title: event.name,
                      host: event.organizer?.name,
                      location:
                        event.location.name || event.location.addressLocality,
                      attendeeCount: event.attendeeCount,
                      thumbnail: event.image
                        ? getMediaUrl(event.image)
                        : undefined,
                      href: `/events/${event.id}`,
                      mineral: categoryToMineral(event.category),
                      category: event.category,
                    }))}
                  />
                )}
              </TabsContent>

              <TabsContent value="stream">
                {isAuthenticated && viewer.canUseChat && (
                  <CircleDiscuss
                    circleId={circleId}
                    isAuthenticated={isAuthenticated}
                  />
                )}
                {isAuthenticated && viewer.canPost && (
                  <NyuchiContentComposer
                    className="mb-4"
                    placeholder={t("circle.compose.placeholder")}
                    userName={user?.name ?? undefined}
                    submitLabel="Post"
                    submitting={submitting}
                    showToolbar={false}
                    onSubmit={handlePost}
                  />
                )}

                {posts.length === 0 ? (
                  <Card className="border-0 bg-surface">
                    <CardContent className="p-8 text-center text-text-secondary text-sm">
                      {t("circle.empty")}
                    </CardContent>
                  </Card>
                ) : (
                  <ul className="space-y-3">
                    {posts.map((post) => (
                      <li key={post.id}>
                        <Card className="border-0 bg-surface">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3 mb-2">
                              <div
                                className="w-9 h-9 rounded-full bg-elevated flex items-center justify-center text-sm font-semibold shrink-0"
                                aria-hidden
                              >
                                {authorInitial(authorLabel(post.author))}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold">
                                  {authorLabel(post.author)}
                                </div>
                                <div className="text-xs text-text-tertiary">
                                  {post.created_at &&
                                    new Date(post.created_at).toLocaleString()}
                                </div>
                              </div>
                            </div>
                            {post.text && (
                              <p className="text-[15px] leading-relaxed whitespace-pre-wrap mb-3">
                                {post.text}
                              </p>
                            )}
                            <div className="flex items-center gap-4 text-sm text-text-secondary">
                              <button
                                type="button"
                                onClick={() => handleReaction(post.id)}
                                disabled={!isAuthenticated || !viewer.canReact}
                                className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
                              >
                                <Heart className="w-4 h-4" aria-hidden />
                                {post.like_count ?? 0}
                              </button>
                              <span className="inline-flex items-center gap-1.5">
                                <MessageCircle
                                  className="w-4 h-4"
                                  aria-hidden
                                />
                                {post.comment_count ?? 0}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="members">
                {members.length === 0 ? (
                  <Card className="border-0 bg-surface">
                    <CardContent className="p-8 text-center text-text-secondary text-sm">
                      No members yet.
                    </CardContent>
                  </Card>
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {members.map((m) => (
                      <li key={m.person_id}>
                        <Card className="border-0 bg-surface">
                          <CardContent className="p-3 flex items-center gap-3">
                            <div
                              className="w-10 h-10 rounded-full bg-elevated flex items-center justify-center font-semibold shrink-0"
                              aria-hidden
                            >
                              {authorInitial(authorLabel(m.person))}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold truncate">
                                {authorLabel(m.person)}
                              </div>
                              <div className="text-xs text-text-tertiary uppercase tracking-wider">
                                {m.role}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="calendars">
                {isOwner && (
                  <AttachCalendar
                    circleId={circleId}
                    attachedIds={calendars.map((c) => c.id)}
                    onAttached={refetchCalendars}
                  />
                )}
                {calendars.length === 0 ? (
                  <Card className="border-0 bg-surface">
                    <CardContent className="p-8 text-center text-text-secondary text-sm">
                      <CalendarRange
                        className="w-8 h-8 mx-auto mb-2 text-text-tertiary"
                        aria-hidden
                      />
                      No calendars stream through this circle yet.
                    </CardContent>
                  </Card>
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {calendars.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/calendars/${c.slug}`}
                          className="group flex items-center gap-4 rounded-[var(--radius-card,14px)] border border-border bg-card px-4 py-3.5 transition-shadow hover:shadow-md"
                        >
                          <span
                            className="flex size-12 shrink-0 items-center justify-center rounded-xl text-primary-foreground"
                            style={{
                              background: getTheme(c.theme ?? undefined)
                                .gradient,
                            }}
                            aria-hidden
                          >
                            <CalendarRange className="w-5 h-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                              {c.name}
                            </span>
                            {c.description && (
                              <span className="block text-[13px] text-muted-foreground line-clamp-2">
                                {c.description}
                              </span>
                            )}
                            <span className="mt-1 inline-flex items-center gap-1 text-xs text-text-tertiary">
                              <Users className="w-3 h-3" aria-hidden />
                              {c.followerCount}{" "}
                              {c.followerCount === 1 ? "follower" : "followers"}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="archive">
                {archived.length === 0 ? (
                  <Card className="border-0 bg-surface">
                    <CardContent className="p-8 text-center text-text-secondary text-sm">
                      <Archive
                        className="w-8 h-8 mx-auto mb-2 text-text-tertiary"
                        aria-hidden
                      />
                      Nothing archived yet.
                    </CardContent>
                  </Card>
                ) : (
                  <ul className="space-y-3">
                    {archived.map((post) => (
                      <li key={post.id}>
                        <Card className="border-0 bg-surface opacity-80">
                          <CardContent className="p-4">
                            <div className="text-xs text-text-tertiary mb-2">
                              {authorLabel(post.author)} ·{" "}
                              {post.created_at &&
                                new Date(post.created_at).toLocaleDateString()}
                            </div>
                            {post.text && (
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                {post.text}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
