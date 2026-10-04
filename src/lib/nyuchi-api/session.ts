import "server-only";

/**
 * The Nyuchi API as the signed-in person, from the AuthKit session.
 *
 * The local dev bypass (`DEV_AUTH_BYPASS=1`) has no AuthKit token and so
 * cannot act for anyone on the API: person calls throw a clear error there
 * rather than writing to MongoDB behind the API's back.
 */

import { withAuth } from "@workos-inc/authkit-nextjs";
import { isDevBypass } from "@/lib/auth/dev";
import { asPerson, type NyuchiApi } from "./client";

export class SignInRequired extends Error {
  constructor(message = "You must be signed in to do that.") {
    super(message);
    this.name = "SignInRequired";
  }
}

/** The API acting for the signed-in person; throws when there is no session. */
export async function personApi(): Promise<NyuchiApi> {
  if (isDevBypass()) {
    throw new SignInRequired(
      "The dev sign-in bypass cannot call the Nyuchi API as a person. Sign in with WorkOS locally.",
    );
  }
  const { user, accessToken } = await withAuth();
  if (!user || !accessToken) throw new SignInRequired();
  return asPerson(accessToken);
}

/** The API acting for the signed-in person, or null when signed out. */
export async function optionalPersonApi(): Promise<NyuchiApi | null> {
  if (isDevBypass()) return null;
  const { user, accessToken } = await withAuth();
  if (!user || !accessToken) return null;
  return asPerson(accessToken);
}
