"use server";

/**
 * Create a circle — `POST /v1/circles` on the Nyuchi API, as the signed-in
 * person (mukoko-dev/mukoko-events#159). The API is the only writer of
 * circles (#154), so this never writes to MongoDB: without Mukoko Events'
 * API key, creating a circle says it isn't available yet.
 *
 * The API makes the creator the circle's owner and first member and answers
 * `201` with the circle. `409` means the slug is taken (another is offered);
 * `422` errors are mapped back to their fields.
 */

import { isNyuchiApiConfigured, NyuchiApiError } from "@/lib/nyuchi-api/client";
import { personApi, SignInRequired } from "@/lib/nyuchi-api/session";
import { unwrap, type ApiCircle } from "@/lib/nyuchi-api/circles";
import { ensurePlaceFromOsmSuggestion } from "@/app/actions/geocode";
import {
  API_FIELD,
  nextSlug,
  toApiBody,
  validateCreateCircle,
  type CreateCircleInput,
  type FieldErrors,
} from "@/lib/circle-create";

export type CreateCircleResult =
  | {
      ok: true;
      circle: { id: string; slug: string; circleType: string };
    }
  | {
      ok: false;
      /** A sentence for the whole form. */
      formError: string | null;
      fieldErrors: FieldErrors;
      /** Offered when the slug is taken. */
      suggestedSlug?: string;
      /** The person must sign in first. */
      signInRequired?: boolean;
    };

const fail = (
  formError: string | null,
  fieldErrors: FieldErrors = {},
  extra: Partial<Extract<CreateCircleResult, { ok: false }>> = {},
): CreateCircleResult => ({ ok: false, formError, fieldErrors, ...extra });

/** An OSM pick from the place search, promoted to a catalogue place id. */
export interface OsmPlacePick {
  name: string;
  address: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  osmType: string;
  osmId: number;
}

export async function createCircleAction(
  input: CreateCircleInput,
  osmPlace?: OsmPlacePick | null,
): Promise<CreateCircleResult> {
  const fieldErrors = validateCreateCircle(input);
  if (Object.keys(fieldErrors).length > 0) {
    return fail("Check the highlighted fields.", fieldErrors);
  }
  if (!isNyuchiApiConfigured()) {
    return fail(
      "Creating a circle isn't available here yet. Please try again later.",
    );
  }

  let api;
  try {
    api = await personApi();
  } catch (err) {
    if (err instanceof SignInRequired) {
      return fail("Sign in to create a circle.", {}, { signInRequired: true });
    }
    throw err;
  }

  let placeId = input.placeId;
  if (!placeId && osmPlace) {
    placeId = await ensurePlaceFromOsmSuggestion(osmPlace);
  }

  try {
    const circle = unwrap<ApiCircle>(
      await api.post("/v1/circles", toApiBody({ ...input, placeId })),
      "circle",
    );
    if (!circle?._id) {
      return fail("Your circle couldn't be created. Please try again.");
    }
    return {
      ok: true,
      circle: {
        id: circle._id,
        slug: circle.slug ?? input.slug,
        circleType: circle.circleType ?? input.circleType,
      },
    };
  } catch (err) {
    if (!(err instanceof NyuchiApiError)) {
      console.warn("[mukoko] createCircleAction failed:", err);
      return fail("Your circle couldn't be created. Please try again.");
    }
    if (err.status === 401) {
      return fail("Sign in to create a circle.", {}, { signInRequired: true });
    }
    if (err.status === 409) {
      return fail(
        null,
        { slug: "That address is taken. Choose another." },
        { suggestedSlug: nextSlug(input.slug.trim()) },
      );
    }
    if (err.status === 422) {
      const mapped: FieldErrors = {};
      for (const d of err.details) {
        const key = [...d.loc]
          .reverse()
          .find((k) => typeof k === "string" && k in API_FIELD);
        const field = typeof key === "string" ? API_FIELD[key] : undefined;
        if (field && !mapped[field]) mapped[field] = d.msg;
      }
      return Object.keys(mapped).length > 0
        ? fail("Check the highlighted fields.", mapped)
        : fail(err.message || "Check the form and try again.");
    }
    console.warn("[mukoko] createCircleAction refused:", err.status);
    return fail(
      err.message || "Your circle couldn't be created. Please try again.",
    );
  }
}
