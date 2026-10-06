import "server-only";

/**
 * Circles on the Nyuchi API (`/v1/circles`) — the shapes it returns and small
 * mappers. The API is the single writer for the `circles` database
 * (nyuchi/api-gateway#197; rules in that repo's docs/architecture/circles.md).
 *
 * Documents come back as the stored v3.1 camelCase records, with dates as ISO
 * strings. Lists are `{ data: [...] }`; single reads are the record itself or
 * wrapped (`{ circle }`, `{ post }`, `{ membership }`, `{ conversation }`), so
 * `unwrap` accepts either.
 */

import { seg, type NyuchiApi } from "./client";

export interface ApiCircle {
  _id: string;
  name: string;
  slug?: string;
  description?: string | null;
  circleType?: "public" | "private" | "secret" | "broadcast";
  ownerPersonId: string;
  memberCount?: number;
  postCount?: number;
  primaryEventId?: string | null;
  isActive?: boolean;
  /**
   * The caller's own membership (`GET /v1/circles/{id}`), or null when the
   * caller has no row. The access policy runs on this.
   */
  viewerMembership?: { role: string; membershipStatus: string } | null;
}

export interface ApiMembership {
  _id?: string;
  circleId: string;
  memberPersonId: string;
  role: string;
  membershipStatus: string;
  joinedAt?: string | null;
}

export interface ApiPost {
  _id: string;
  circleId: string;
  authorPersonId: string;
  articleBody?: string | null;
  headline?: string | null;
  postType?: string | null;
  reactionCount?: number;
  commentCount?: number;
  moderationStatus?: string | null;
  datePublished?: string | null;
  createdAt?: string | null;
  /** The caller's own reaction key, when the API reports it. */
  myReaction?: string | null;
  viewerReaction?: string | null;
}

/** A person's public profile fields (`GET /v1/identity/person/{id}`). */
export interface ApiPersonProfile {
  id: string;
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
}

/** `{ key: value }` → value, or the body itself when it isn't wrapped. */
export function unwrap<T>(body: unknown, key: string): T {
  if (body && typeof body === "object" && key in body) {
    return (body as Record<string, unknown>)[key] as T;
  }
  return body as T;
}

/** `{ data: [...] }` → the array (an array body is accepted as-is). */
export function listOf<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/** The caller's reaction on a post, under whichever name the API uses. */
export function viewerReactionOf(post: ApiPost): string | null {
  return post.myReaction ?? post.viewerReaction ?? null;
}

const MAX_HYDRATE = 100;

/**
 * Public profiles for a batch of person ids, one read each (the API has no
 * batch person read yet — mukoko-dev/mukoko-events#154 follow-up). A profile that
 * can't be read is simply absent; the UI falls back to no name.
 */
export async function personProfiles(
  api: NyuchiApi,
  ids: string[],
): Promise<Map<string, ApiPersonProfile>> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_HYDRATE);
  const out = new Map<string, ApiPersonProfile>();
  await Promise.all(
    unique.map(async (id) => {
      try {
        const body = await api.get(`/v1/identity/person/${seg(id)}`);
        const profile = unwrap<ApiPersonProfile>(body, "data");
        if (profile?.id) out.set(id, profile);
      } catch {
        // Not readable (deleted, deactivated, or a transient failure).
      }
    }),
  );
  return out;
}

export const circlesPath = {
  list: (query: Record<string, string | number | boolean> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, String(v)]),
    ).toString();
    return `/v1/circles${qs ? `?${qs}` : ""}`;
  },
  featured: (limit: number) => `/v1/circles/featured?limit=${limit}`,
  circle: (id: string) => `/v1/circles/${seg(id)}`,
  join: (id: string) => `/v1/circles/${seg(id)}/join`,
  members: (id: string, limit: number) =>
    `/v1/circles/${seg(id)}/members?limit=${limit}`,
  posts: (id: string, limit?: number) =>
    `/v1/circles/${seg(id)}/posts${limit ? `?limit=${limit}` : ""}`,
  moderation: (id: string, limit: number) =>
    `/v1/circles/${seg(id)}/moderation?limit=${limit}`,
  post: (id: string, postId: string) =>
    `/v1/circles/${seg(id)}/posts/${seg(postId)}`,
  reaction: (id: string, postId: string) =>
    `/v1/circles/${seg(id)}/posts/${seg(postId)}/reaction`,
  conversation: (id: string) => `/v1/circles/${seg(id)}/conversation`,
};
