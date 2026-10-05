/**
 * Creating a circle — the field rules, shared by the form (instant feedback)
 * and the server action (the check that counts). They mirror the Nyuchi API's
 * `CircleCreate` model for `POST /v1/circles` (nyuchi/api-gateway
 * `gateway/routers/circles.py`), which stays the final word.
 *
 * Pure and dependency-free, so the client can import it.
 */

import type { CircleType } from "@/lib/circle-access";

export const NAME_MAX = 120;
export const SLUG_MAX = 64;
export const DESCRIPTION_MAX = 2000;
export const RULES_MAX = 30;
export const RULE_MAX = 300;
export const TAGS_MAX = 30;
export const TAG_MAX = 50;
export const CATEGORIES_MAX = 20;

/** Slugs a circle cannot take: they are discovery routes on circles.mukoko.com. */
export const RESERVED_SLUGS: readonly string[] = ["categories"];

/** Lower-case letters and digits, with hyphens inside only. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export type PostApproval = "off" | "all";

/** The four circle types, each with who can find, join, read and post. */
export const CIRCLE_TYPE_OPTIONS: readonly {
  value: CircleType;
  label: string;
  explanation: string;
}[] = [
  {
    value: "public",
    label: "Public",
    explanation:
      "Anyone can find it, read its public posts and join at once. Members post.",
  },
  {
    value: "private",
    label: "Private",
    explanation:
      "Anyone can find it and see its name and description. People ask to join and you approve them. Only members read and post.",
  },
  {
    value: "secret",
    label: "Secret",
    explanation:
      "Hidden from everyone who isn't in it. People join only by invitation. Only members read and post.",
  },
  {
    value: "broadcast",
    label: "Broadcast",
    explanation:
      "Anyone can find it, read it and follow it. Only you and your circle's staff post.",
  },
];

export const POST_APPROVAL_OPTIONS: readonly {
  value: PostApproval;
  label: string;
  explanation: string;
}[] = [
  {
    value: "off",
    label: "Publish posts at once",
    explanation: "Members' posts appear straight away.",
  },
  {
    value: "all",
    label: "Approve every post first",
    explanation: "You or your moderators approve each post before it appears.",
  },
];

export const LANGUAGE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "sn", label: "chiShona" },
  { value: "nd", label: "isiNdebele" },
  { value: "fr", label: "Français" },
  { value: "pt", label: "Português" },
  { value: "sw", label: "Kiswahili" },
];

/** What the form submits. */
export interface CreateCircleInput {
  name: string;
  slug: string;
  description: string;
  circleType: CircleType;
  postApproval: PostApproval;
  inLanguage: string;
  interestCategoryIds: string[];
  placeId: string | null;
  rules: string[];
  tags: string[];
}

export type CreateCircleField = keyof CreateCircleInput;

export type FieldErrors = Partial<Record<CreateCircleField, string>>;

/** A slug from a name: lower case, digits and inner hyphens, at most 64. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/**
 * Another slug to offer when one is taken: `name-2`, `name-3`, … kept within
 * the length limit.
 */
export function nextSlug(slug: string): string {
  const match = /^(.*?)-(\d+)$/.exec(slug);
  const base = match ? match[1] : slug;
  const n = match ? Number(match[2]) + 1 : 2;
  const suffix = `-${n}`;
  return `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

/** One entry per line, trimmed, blanks dropped. */
export function lines(value: string): string[] {
  return value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Comma-separated tags, trimmed, lower-cased, de-duplicated. */
export function tagList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((t) => t.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const TYPES: readonly string[] = CIRCLE_TYPE_OPTIONS.map((o) => o.value);
const LANGS: readonly string[] = LANGUAGE_OPTIONS.map((o) => o.value);

/** Check every field; an empty object means the input can be sent. */
export function validateCreateCircle(input: CreateCircleInput): FieldErrors {
  const errors: FieldErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "Give your circle a name.";
  else if (name.length > NAME_MAX)
    errors.name = `Keep the name to ${NAME_MAX} characters or fewer.`;

  const slug = input.slug.trim();
  if (!slug) errors.slug = "Choose a web address for your circle.";
  else if (slug.length > SLUG_MAX)
    errors.slug = `Keep the address to ${SLUG_MAX} characters or fewer.`;
  else if (!SLUG_RE.test(slug))
    errors.slug =
      "Use lower-case letters, digits and hyphens, starting and ending with a letter or digit.";
  else if (RESERVED_SLUGS.includes(slug))
    errors.slug = "That address is reserved. Choose another.";

  if (input.description.length > DESCRIPTION_MAX)
    errors.description = `Keep the description to ${DESCRIPTION_MAX} characters or fewer.`;

  if (!TYPES.includes(input.circleType))
    errors.circleType = "Choose who can find and join your circle.";

  if (input.postApproval !== "off" && input.postApproval !== "all")
    errors.postApproval = "Choose how posts are published.";

  if (!LANGS.includes(input.inLanguage))
    errors.inLanguage = "Choose your circle's language.";

  if (input.interestCategoryIds.length > CATEGORIES_MAX)
    errors.interestCategoryIds = `Choose up to ${CATEGORIES_MAX} interests.`;

  if (input.rules.length > RULES_MAX)
    errors.rules = `Keep to ${RULES_MAX} rules or fewer.`;
  else if (input.rules.some((r) => r.length > RULE_MAX))
    errors.rules = `Keep each rule to ${RULE_MAX} characters or fewer.`;

  if (input.tags.length > TAGS_MAX)
    errors.tags = `Keep to ${TAGS_MAX} tags or fewer.`;
  else if (input.tags.some((t) => t.length > TAG_MAX))
    errors.tags = `Keep each tag to ${TAG_MAX} characters or fewer.`;

  return errors;
}

/** The `POST /v1/circles` body (snake_case), from a validated input. */
export function toApiBody(input: CreateCircleInput) {
  return {
    name: input.name.trim(),
    slug: input.slug.trim(),
    description: input.description.trim() || null,
    circle_type: input.circleType,
    post_approval: input.postApproval,
    in_language: input.inLanguage,
    interest_category_ids: input.interestCategoryIds,
    place_id: input.placeId || null,
    rules: input.rules,
    tags: input.tags,
    surface_context: "events",
  };
}

/** The API's snake_case field names → the form's fields, for 422 answers. */
export const API_FIELD: Record<string, CreateCircleField> = {
  name: "name",
  slug: "slug",
  description: "description",
  circle_type: "circleType",
  post_approval: "postApproval",
  in_language: "inLanguage",
  interest_category_ids: "interestCategoryIds",
  place_id: "placeId",
  rules: "rules",
  tags: "tags",
};

/** A circle shows on circles.mukoko.com when it is public or broadcast. */
export function circlesSiteUrl(
  slug: string,
  circleType: string,
): string | null {
  return circleType === "public" || circleType === "broadcast"
    ? `https://circles.mukoko.com/c/${encodeURIComponent(slug)}`
    : null;
}
