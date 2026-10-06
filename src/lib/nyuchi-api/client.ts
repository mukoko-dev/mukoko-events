import "server-only";

/**
 * Server-only client for the Nyuchi API (api.nyuchi.com) — the single writer
 * for the `circles` database (nyuchi/api-gateway#197, mukoko-dev/mukoko-events#154).
 *
 * Two ways to call it, both with Mukoko Events' own INTERNAL key pair
 * (`NYUCHI_API_CLIENT_ID` / `NYUCHI_API_CLIENT_SECRET`, server env only):
 *
 * - `asPerson(accessToken)` — the signed-in person. Their AuthKit access token
 *   is exchanged (RFC 8693, `POST /v1/auth/token`) for a short-lived platform
 *   JWT whose `sub` is their person id. A first sign-in with no person yet
 *   (`404 person_not_found`) is provisioned once with
 *   `POST /v1/identity/persons/ensure`, then exchanged again.
 * - `asService()` — anonymous public reads (featured circles, a circle's name
 *   on a calendar page) with a `client_credentials` machine token.
 *
 * Tokens are cached in memory for their `expires_in` minus a margin, keyed on
 * a SHA-256 of the AuthKit token — never the token itself. Nothing here is
 * logged: no token, secret, or response body.
 *
 * The switch is flag-guarded by the credentials themselves: circle reads and
 * writes go through the API only when `isNyuchiApiConfigured()` is true (both
 * `NYUCHI_API_CLIENT_ID` and `NYUCHI_API_CLIENT_SECRET` set). Until the owner
 * mints the key, the app keeps its server-side MongoDB path, held to the same
 * access policy (`@/lib/circle-access`). Once configured there is no silent
 * fallback: an API failure is an error, never a write around the API. Code
 * that calls the API without checking the flag gets `NyuchiApiNotConfigured`.
 */

import { createHash } from "node:crypto";

const DEFAULT_BASE_URL = "https://api.nyuchi.com";
const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
/** The namespaces a person token from Mukoko Events needs. */
export const PERSON_SCOPE = "identity circles campfire events";
/** Seconds shaved off `expires_in` so a cached token is never used stale. */
const EXPIRY_MARGIN_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 10_000;

export class NyuchiApiNotConfigured extends Error {
  constructor() {
    super(
      "The Nyuchi API is not configured: set NYUCHI_API_CLIENT_ID and NYUCHI_API_CLIENT_SECRET.",
    );
    this.name = "NyuchiApiNotConfigured";
  }
}

/** A non-2xx answer from the API, carrying its status and its sentence. */
export class NyuchiApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** A validation answer's per-field list (FastAPI `detail: [{loc, msg}]`). */
  readonly details: { loc: unknown[]; msg: string }[];

  constructor(
    status: number,
    message: string,
    code: string | null = null,
    details: { loc: unknown[]; msg: string }[] = [],
  ) {
    super(message);
    this.name = "NyuchiApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * True when Mukoko Events' Nyuchi API key pair is set. This is the switch for
 * the circles migration (mukoko-dev/mukoko-events#154): set → the API is the
 * reader and writer of circles; unset → the server-side MongoDB path.
 */
export function isNyuchiApiConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.NYUCHI_API_CLIENT_ID?.trim() && env.NYUCHI_API_CLIENT_SECRET?.trim(),
  );
}

interface Credentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export function readCredentials(
  env: NodeJS.ProcessEnv = process.env,
): Credentials {
  const clientId = env.NYUCHI_API_CLIENT_ID?.trim();
  const clientSecret = env.NYUCHI_API_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new NyuchiApiNotConfigured();
  const baseUrl = (env.NYUCHI_API_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  return { baseUrl, clientId, clientSecret };
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/** Test hook: forget every cached token. */
export function __resetTokenCache(): void {
  tokenCache.clear();
}

/** Test hook: how many tokens are cached. */
export function __tokenCacheSize(): number {
  return tokenCache.size;
}

function cacheKey(kind: "person" | "service", subject: string): string {
  return `${kind}:${createHash("sha256").update(subject).digest("hex")}`;
}

function cached(key: string): string | null {
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  if (hit) tokenCache.delete(key);
  return null;
}

/** Upper bound on cached tokens; AuthKit tokens rotate, so old keys pile up. */
const MAX_CACHED_TOKENS = 1000;

/** Drop expired entries, then the oldest ones while over the cap. */
function prune(now: number): void {
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(key);
  }
  while (tokenCache.size >= MAX_CACHED_TOKENS) {
    const oldest = tokenCache.keys().next().value;
    if (oldest === undefined) break;
    tokenCache.delete(oldest);
  }
}

function remember(key: string, token: string, expiresIn: unknown): void {
  const seconds =
    typeof expiresIn === "number" && Number.isFinite(expiresIn)
      ? expiresIn
      : 60;
  const ttl = Math.max(0, seconds - EXPIRY_MARGIN_SECONDS) * 1000;
  if (ttl <= 0) return;
  const now = Date.now();
  prune(now);
  tokenCache.set(key, { token, expiresAt: now + ttl });
}

async function send(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** The API's own sentence for a refusal: `detail` (string or object) or `error_description`. */
async function refusal(res: Response): Promise<NyuchiApiError> {
  let message = `The Nyuchi API answered ${res.status}.`;
  let code: string | null = null;
  let details: { loc: unknown[]; msg: string }[] = [];
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const detail = body.detail;
    if (Array.isArray(detail)) {
      details = detail.flatMap((d) =>
        d &&
        typeof d === "object" &&
        typeof (d as { msg?: unknown }).msg === "string"
          ? [
              {
                loc: Array.isArray((d as { loc?: unknown }).loc)
                  ? (d as { loc: unknown[] }).loc
                  : [],
                msg: (d as { msg: string }).msg,
              },
            ]
          : [],
      );
      if (details[0]) message = details[0].msg;
    } else if (typeof detail === "string") message = detail;
    else if (detail && typeof detail === "object") {
      const d = detail as Record<string, unknown>;
      if (typeof d.error_description === "string")
        message = d.error_description;
      if (typeof d.error === "string") code = d.error;
    }
    if (typeof body.error_description === "string")
      message = body.error_description;
    if (typeof body.error === "string") code = body.error;
  } catch {
    // Not JSON — keep the generic sentence.
  }
  return new NyuchiApiError(res.status, message, code, details);
}

function keyHeaders(creds: Credentials): Record<string, string> {
  return {
    "X-Client-Id": creds.clientId,
    "X-Client-Secret": creds.clientSecret,
  };
}

async function tokenRequest(
  creds: Credentials,
  form: Record<string, string>,
): Promise<Response> {
  return send(`${creds.baseUrl}/v1/auth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...keyHeaders(creds),
    },
    body: new URLSearchParams({
      ...form,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString(),
  });
}

async function exchange(
  creds: Credentials,
  accessToken: string,
): Promise<Response> {
  return tokenRequest(creds, {
    grant_type: TOKEN_EXCHANGE,
    subject_token: accessToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    scope: PERSON_SCOPE,
  });
}

/** Exchange the person's AuthKit access token for a platform person token. */
export async function personToken(accessToken: string): Promise<string> {
  const creds = readCredentials();
  const key = cacheKey("person", accessToken);
  const hit = cached(key);
  if (hit) return hit;

  let res = await exchange(creds, accessToken);
  if (res.status === 404) {
    // A first sign-in: provision the person once, then exchange again.
    const ensured = await send(`${creds.baseUrl}/v1/identity/persons/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json", ...keyHeaders(creds) },
      body: JSON.stringify({
        subject_token: accessToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
      }),
    });
    if (!ensured.ok) throw await refusal(ensured);
    res = await exchange(creds, accessToken);
  }
  if (!res.ok) throw await refusal(res);
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token)
    throw new NyuchiApiError(502, "The Nyuchi API issued no token.");
  remember(key, body.access_token, body.expires_in);
  return body.access_token;
}

/** A `client_credentials` machine token for anonymous public reads. */
export async function serviceToken(): Promise<string> {
  const creds = readCredentials();
  const key = cacheKey("service", creds.clientId);
  const hit = cached(key);
  if (hit) return hit;
  const res = await tokenRequest(creds, { grant_type: "client_credentials" });
  if (!res.ok) throw await refusal(res);
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token)
    throw new NyuchiApiError(502, "The Nyuchi API issued no token.");
  remember(key, body.access_token, body.expires_in);
  return body.access_token;
}

export interface NyuchiApi {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
}

function bound(getToken: () => Promise<string>): NyuchiApi {
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!path.startsWith("/v1/"))
      throw new Error("Nyuchi API paths start with /v1/.");
    const creds = readCredentials();
    const token = await getToken();
    const res = await send(`${creds.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await refusal(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body ?? {}),
    put: (path, body) => call("PUT", path, body ?? {}),
    patch: (path, body) => call("PATCH", path, body ?? {}),
    delete: (path) => call("DELETE", path),
  };
}

/** The API, acting for the person whose AuthKit access token this is. */
export function asPerson(accessToken: string): NyuchiApi {
  return bound(() => personToken(accessToken));
}

/** The API, as Mukoko Events itself (public reads only). */
export function asService(): NyuchiApi {
  return bound(() => serviceToken());
}

/** One path segment, encoded. Every id in a path goes through this. */
export function seg(value: string): string {
  if (!value || value.length > 200) throw new Error("Invalid identifier.");
  return encodeURIComponent(value);
}
