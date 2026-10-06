"use client";

/**
 * The create-circle form at /circles?create=1 (mukoko-dev/mukoko-events#159).
 * circles.mukoko.com's "Create a circle" button lands here. The form checks
 * each field as you go with the same rules the server action applies; the
 * Nyuchi API (`POST /v1/circles`) has the final word. On success it opens
 * the new circle's page.
 */

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import {
  createCircleAction,
  type OsmPlacePick,
} from "@/app/actions/create-circle";
import {
  CATEGORIES_MAX,
  CIRCLE_TYPE_OPTIONS,
  DESCRIPTION_MAX,
  LANGUAGE_OPTIONS,
  NAME_MAX,
  POST_APPROVAL_OPTIONS,
  SLUG_MAX,
  lines,
  slugify,
  tagList,
  validateCreateCircle,
  type CreateCircleField,
  type CreateCircleInput,
  type FieldErrors,
  type PostApproval,
} from "@/lib/circle-create";
import type { CircleType } from "@/lib/circle-access";

export interface InterestCategoryOption {
  id: string;
  name: string;
}

interface CreateCircleFormProps {
  categories: InterestCategoryOption[];
  /** False until Mukoko Events' Nyuchi API key is set. */
  available: boolean;
}

export function CreateCircleForm({
  categories,
  available,
}: CreateCircleFormProps) {
  const router = useRouter();
  const ids = useId();
  const fid = (f: string) => `${ids}-${f}`;

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [circleType, setCircleType] = useState<CircleType>("public");
  const [postApproval, setPostApproval] = useState<PostApproval>("off");
  const [inLanguage, setInLanguage] = useState("en");
  const [interests, setInterests] = useState<string[]>([]);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [osmPlace, setOsmPlace] = useState<OsmPlacePick | null>(null);
  const [rulesText, setRulesText] = useState("");
  const [tagsText, setTagsText] = useState("");

  const [touched, setTouched] = useState<
    Partial<Record<CreateCircleField, boolean>>
  >({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [suggestedSlug, setSuggestedSlug] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const input: CreateCircleInput = {
    name,
    slug,
    description,
    circleType,
    postApproval,
    inLanguage,
    interestCategoryIds: interests,
    placeId,
    rules: lines(rulesText),
    tags: tagList(tagsText),
  };
  const clientErrors = validateCreateCircle(input);
  const errorFor = (f: CreateCircleField): string | undefined =>
    serverErrors[f] ?? (touched[f] || submitted ? clientErrors[f] : undefined);
  const touch = (f: CreateCircleField) =>
    setTouched((t) => (t[f] ? t : { ...t, [f]: true }));
  const clearServer = (f: CreateCircleField) =>
    setServerErrors((e) => {
      if (!e[f]) return e;
      const next = { ...e };
      delete next[f];
      return next;
    });

  const onName = (value: string) => {
    setName(value);
    clearServer("name");
    if (!slugEdited) {
      setSlug(slugify(value));
      clearServer("slug");
      setSuggestedSlug(null);
    }
  };

  const onSlug = (value: string) => {
    setSlugEdited(true);
    setSlug(value.toLowerCase());
    clearServer("slug");
    setSuggestedSlug(null);
  };

  const toggleInterest = (id: string, on: boolean) => {
    setInterests((list) =>
      on
        ? list.includes(id)
          ? list
          : [...list, id]
        : list.filter((x) => x !== id),
    );
    clearServer("interestCategoryIds");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) {
      setFormError("Check the highlighted fields.");
      const first = Object.keys(clientErrors)[0];
      document.getElementById(fid(first))?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const result = await createCircleAction(input, placeId ? null : osmPlace);
      if (result.ok) {
        router.push(
          `/circles/${encodeURIComponent(result.circle.id)}?created=1`,
        );
        return;
      }
      setNeedsSignIn(Boolean(result.signInRequired));
      setServerErrors(result.fieldErrors);
      setFormError(result.formError);
      setSuggestedSlug(result.suggestedSlug ?? null);
      const first = Object.keys(result.fieldErrors)[0];
      if (first) document.getElementById(fid(first))?.focus();
    } catch {
      setFormError("Your circle couldn't be created. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const describedBy = (f: CreateCircleField, hint = true) =>
    [hint ? `${fid(f)}-hint` : null, errorFor(f) ? `${fid(f)}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const fieldError = (field: CreateCircleField) =>
    errorFor(field) ? (
      <p id={`${fid(field)}-error`} className="text-sm text-error mt-1">
        {errorFor(field)}
      </p>
    ) : null;

  if (!available) {
    return (
      <section
        aria-labelledby={`${ids}-unavailable`}
        className="rounded-(--radius-card) bg-surface p-8"
      >
        <h2
          id={`${ids}-unavailable`}
          className="font-serif text-xl font-semibold mb-2"
        >
          Creating a circle isn&apos;t available yet
        </h2>
        <p className="text-text-secondary mb-5">
          We&apos;re finishing the connection that creates circles. Please try
          again soon.
        </p>
        <Link
          href="/circles"
          className="text-primary underline underline-offset-4"
        >
          Back to your circles
        </Link>
      </section>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${ids}-title`}
      className="rounded-(--radius-card) bg-surface p-6 md:p-8 space-y-8"
    >
      <div>
        <h2 id={`${ids}-title`} className="font-serif text-2xl font-semibold">
          Create a circle
        </h2>
        <p className="text-text-secondary mt-1">
          A circle keeps your community together between events. You&apos;ll be
          its owner.
        </p>
      </div>

      {formError && (
        <p
          role="alert"
          className="rounded-md border border-error p-3 text-sm text-error"
        >
          {formError}
          {needsSignIn && (
            <>
              {" "}
              <Link
                href={`/auth/hosted?return_to=${encodeURIComponent("/circles?create=1")}`}
                className="underline underline-offset-4"
              >
                Sign in
              </Link>
            </>
          )}
        </p>
      )}

      {/* Name */}
      <div>
        <Label htmlFor={fid("name")}>Name</Label>
        <Input
          id={fid("name")}
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => onName(e.target.value)}
          onBlur={() => touch("name")}
          aria-invalid={Boolean(errorFor("name"))}
          aria-describedby={describedBy("name")}
          aria-required
          className="mt-2"
        />
        <p
          id={`${fid("name")}-hint`}
          className="text-sm text-text-secondary mt-1"
        >
          Up to {NAME_MAX} characters.
        </p>
        {fieldError("name")}
      </div>

      {/* Slug */}
      <div>
        <Label htmlFor={fid("slug")}>Web address</Label>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-text-secondary whitespace-nowrap">
            circles.mukoko.com/c/
          </span>
          <Input
            id={fid("slug")}
            value={slug}
            maxLength={SLUG_MAX}
            onChange={(e) => onSlug(e.target.value)}
            onBlur={() => touch("slug")}
            aria-invalid={Boolean(errorFor("slug"))}
            aria-describedby={describedBy("slug")}
            aria-required
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <p
          id={`${fid("slug")}-hint`}
          className="text-sm text-text-secondary mt-1"
        >
          Lower-case letters, digits and hyphens, up to {SLUG_MAX} characters.
        </p>
        {fieldError("slug")}
        {suggestedSlug && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => onSlug(suggestedSlug)}
          >
            Use {suggestedSlug}
          </Button>
        )}
      </div>

      {/* Description */}
      <div>
        <Label htmlFor={fid("description")}>Description (optional)</Label>
        <Textarea
          id={fid("description")}
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={4}
          onChange={(e) => {
            setDescription(e.target.value);
            clearServer("description");
          }}
          onBlur={() => touch("description")}
          aria-invalid={Boolean(errorFor("description"))}
          aria-describedby={describedBy("description")}
          className="mt-2"
        />
        <p
          id={`${fid("description")}-hint`}
          className="text-sm text-text-secondary mt-1"
        >
          {description.length} of {DESCRIPTION_MAX} characters.
        </p>
        {fieldError("description")}
      </div>

      {/* Circle type */}
      <fieldset aria-describedby={describedBy("circleType", false)}>
        <legend className="text-sm font-medium">
          Who can find and join it
        </legend>
        <RadioGroup
          id={fid("circleType")}
          value={circleType}
          onValueChange={(v) => {
            setCircleType(v as CircleType);
            clearServer("circleType");
          }}
          className="mt-3 space-y-3"
        >
          {CIRCLE_TYPE_OPTIONS.map((o) => (
            <div key={o.value} className="flex items-start gap-3">
              <RadioGroupItem
                value={o.value}
                id={fid(`type-${o.value}`)}
                aria-describedby={fid(`type-${o.value}-desc`)}
                className="mt-1"
              />
              <div>
                <Label htmlFor={fid(`type-${o.value}`)}>{o.label}</Label>
                <p
                  id={fid(`type-${o.value}-desc`)}
                  className="text-sm text-text-secondary"
                >
                  {o.explanation}
                </p>
              </div>
            </div>
          ))}
        </RadioGroup>
        {fieldError("circleType")}
      </fieldset>

      {/* Post approval */}
      <fieldset aria-describedby={describedBy("postApproval", false)}>
        <legend className="text-sm font-medium">Posts</legend>
        <RadioGroup
          id={fid("postApproval")}
          value={postApproval}
          onValueChange={(v) => {
            setPostApproval(v as PostApproval);
            clearServer("postApproval");
          }}
          className="mt-3 space-y-3"
        >
          {POST_APPROVAL_OPTIONS.map((o) => (
            <div key={o.value} className="flex items-start gap-3">
              <RadioGroupItem
                value={o.value}
                id={fid(`approval-${o.value}`)}
                aria-describedby={fid(`approval-${o.value}-desc`)}
                className="mt-1"
              />
              <div>
                <Label htmlFor={fid(`approval-${o.value}`)}>{o.label}</Label>
                <p
                  id={fid(`approval-${o.value}-desc`)}
                  className="text-sm text-text-secondary"
                >
                  {o.explanation}
                </p>
              </div>
            </div>
          ))}
        </RadioGroup>
        {fieldError("postApproval")}
      </fieldset>

      {/* Language */}
      <div>
        <Label htmlFor={fid("inLanguage")}>Language</Label>
        <Select
          value={inLanguage}
          onValueChange={(v) => {
            setInLanguage(v);
            clearServer("inLanguage");
          }}
        >
          <SelectTrigger
            id={fid("inLanguage")}
            className="mt-2 w-full md:w-64"
            aria-invalid={Boolean(errorFor("inLanguage"))}
            aria-describedby={describedBy("inLanguage", false)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldError("inLanguage")}
      </div>

      {/* Interests */}
      {categories.length > 0 && (
        <fieldset aria-describedby={describedBy("interestCategoryIds")}>
          <legend className="text-sm font-medium">Interests (optional)</legend>
          <p
            id={`${fid("interestCategoryIds")}-hint`}
            className="text-sm text-text-secondary mt-1"
          >
            Up to {CATEGORIES_MAX}. They help people find your circle.
          </p>
          <div
            id={fid("interestCategoryIds")}
            className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2"
          >
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <Checkbox
                  id={fid(`interest-${c.id}`)}
                  checked={interests.includes(c.id)}
                  onCheckedChange={(v) => toggleInterest(c.id, v === true)}
                />
                <Label
                  htmlFor={fid(`interest-${c.id}`)}
                  className="font-normal"
                >
                  {c.name}
                </Label>
              </div>
            ))}
          </div>
          {fieldError("interestCategoryIds")}
        </fieldset>
      )}

      {/* Place */}
      <div>
        <Label htmlFor={fid("placeId")}>Place (optional)</Label>
        <p
          id={`${fid("placeId")}-hint`}
          className="text-sm text-text-secondary mt-1"
        >
          Where your circle meets or is based.
        </p>
        <div className="mt-2" id={fid("placeId")}>
          <AddressAutocomplete
            value={placeQuery}
            onChange={(v) => {
              setPlaceQuery(v);
              if (!v) {
                setPlaceId(null);
                setOsmPlace(null);
              }
            }}
            onPlaceSelect={(p) => {
              clearServer("placeId");
              if (p.source === "osm" && p.osmType && p.osmId !== undefined) {
                setPlaceId(null);
                setOsmPlace({
                  name: p.venue,
                  address: p.address,
                  city: p.city,
                  country: p.country,
                  latitude: p.latitude ?? 0,
                  longitude: p.longitude ?? 0,
                  osmType: p.osmType,
                  osmId: p.osmId,
                });
              } else {
                setOsmPlace(null);
                setPlaceId(p.placeId || null);
              }
            }}
            placeholder="Search for a town, city or venue"
          />
        </div>
        {fieldError("placeId")}
      </div>

      {/* Rules */}
      <div>
        <Label htmlFor={fid("rules")}>Rules (optional)</Label>
        <Textarea
          id={fid("rules")}
          value={rulesText}
          rows={4}
          onChange={(e) => {
            setRulesText(e.target.value);
            clearServer("rules");
          }}
          onBlur={() => touch("rules")}
          aria-invalid={Boolean(errorFor("rules"))}
          aria-describedby={describedBy("rules")}
          className="mt-2"
        />
        <p
          id={`${fid("rules")}-hint`}
          className="text-sm text-text-secondary mt-1"
        >
          One rule per line.
        </p>
        {fieldError("rules")}
      </div>

      {/* Tags */}
      <div>
        <Label htmlFor={fid("tags")}>Tags (optional)</Label>
        <Input
          id={fid("tags")}
          value={tagsText}
          onChange={(e) => {
            setTagsText(e.target.value);
            clearServer("tags");
          }}
          onBlur={() => touch("tags")}
          aria-invalid={Boolean(errorFor("tags"))}
          aria-describedby={describedBy("tags")}
          className="mt-2"
        />
        <p
          id={`${fid("tags")}-hint`}
          className="text-sm text-text-secondary mt-1"
        >
          Separate tags with commas.
        </p>
        {fieldError("tags")}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create circle"}
        </Button>
        <Link
          href="/circles"
          className="text-text-secondary underline underline-offset-4"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
