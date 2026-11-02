# Identity sync: direct MongoDB writers and a cut-over plan

Status: draft for discussion. Code-only inventory of this repository at the
time of writing. Nothing here describes live behaviour, and no secret values
appear in it (names only).

Goal: consolidate WorkOS identity sync into the Nyuchi API and retire app-level
writers, without a window that has no writer or two conflicting writers.

## 1. Who writes identity data today

Three writers feed `identity.persons` and the entity membership mirror. All
call the same idempotent functions in `src/lib/mongo/users.ts` and
`src/lib/mongo/entities.ts`.

| Trigger                                        | Entry point                                                                                    | Writes                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| WorkOS webhook `user.created` / `user.updated` | `src/app/api/webhooks/workos/route.ts`                                                         | `syncPersonFromWorkos`: upsert keyed on `workosUserId`                                                                                       |
| WorkOS webhook `user.deleted`                  | same                                                                                           | `deactivatePersonByWorkosId`: soft `isActive=false`, no upsert                                                                               |
| WorkOS webhook `organization_membership.*`     | same                                                                                           | `mirrorWorkosOrganizationMembership` (stub person + org entity + membership upsert), `endWorkosOrganizationMembership` (soft end, no upsert) |
| Sign-in callback                               | `src/app/callback/route.ts` (`onSuccess`)                                                      | `syncPersonFromWorkos`; failures are logged and swallowed                                                                                    |
| First action by a signed-in person (lazy sync) | `resolveActingPerson` in `src/lib/auth/current-person.ts`, plus copies in several action files | `syncPersonFromWorkos` when no person exists                                                                                                 |
| Dev only                                       | `src/app/api/auth/dev-login/route.ts`                                                          | `syncPersonFromWorkos`; returns 404 unless the local dev bypass is on                                                                        |

Semantics worth preserving in any replacement:

- Upserts are keyed on `workosUserId` (persons) and on the WorkOS organization
  / membership ids (entities, memberships).
- `picture` and `emailVerified` are only written when WorkOS supplies them, so
  a custom avatar or a verified flag is never clobbered.
- `user.deleted` and `organization_membership.deleted` never create documents.
- A membership event for an unseen user creates a minimal stub person that a
  later `user.*` event enriches (`$setOnInsert` only).
- A failed mirror write returns 500 so WorkOS retries; handlers are safe to
  replay.

## 2. Every direct MongoDB write in this repository

Source: write calls (`insertOne`, `updateOne`, `findOneAndUpdate`, ...) outside
tests. Collections are named by their accessor in `src/lib/mongo/databases.ts`.
All writes are server-side (Server Actions, route handlers, or `server-only`
modules). The admin app lives in its own repository and was not inspected for
this document.

Identity and entities

- `personsCollection`: `syncPersonFromWorkos`, `ensurePersonForWorkosId`,
  `deactivatePersonByWorkosId` (users.ts); `updateMyProfile` (actions/profile.ts);
  `setDefaultHostEntityForPerson`, `ensureHostEntityForPerson` (entities.ts).
- `entitiesCollection`: `ensureEntityForWorkosOrg`, `renameHostEntityForPerson`,
  `ensureHostEntityForPerson`, `createCommunityEntityForPerson` (entities.ts);
  `ensurePlaceFromOsmSuggestion` (actions/geocode.ts).
- `entityMembershipsCollection`: `mirrorWorkosOrganizationMembership`,
  `endWorkosOrganizationMembership`, `ensureHostEntityForPerson`,
  `createCommunityEntityForPerson` (entities.ts).

Events and attendance

- `eventsCollection`: `createEventForPerson`, `updateEventForPerson`
  (actions/events.ts); `attachEventToCalendar`, `detachEventFromCalendar`
  (calendars.ts); counters in `rsvpToEvent`, `confirmKioskPairing`,
  `submitEventReview`.
- `rsvpsCollection`: `rsvpToEvent`; `setRegistrationApproval`,
  `cancelRegistration`, `checkInAttendee` (host-registrations.ts);
  `checkinViaKiosk`; `submitEventReview`.
- `checkInsCollection`: `checkInAttendee`, `checkinViaKiosk`.
- `pairingsCollection`: `requestKioskPairing`, `confirmKioskPairing`,
  `endKioskSession`, `checkinViaKiosk`.
- `waitlistCollection`: `joinWaitlist`, `leaveWaitlist`.
- `eventUpdatesCollection`: `writeEventUpdateForHost`.
- `pollsCollection`: `castVote`.
- `reviewsCollection`: `submitEventReview`, `markReviewHelpful`.
- `interactionsCollection` / `reactionsCollection`: save, unsave, like, unlike.
- `trackedLinksCollection`: `createTrackedLink`, `recordTrackedLinkClick`.

Calendars, circles, chat

- `calendarsCollection`, `calendarFollowsCollection`: `createCalendar`,
  `updateCalendar`, `archiveCalendar`, `followCalendar`, `unfollowCalendar`.
- `circlesCollection`, `circleMembershipsCollection`, `circlePostsCollection`:
  `createCirclePost`, `joinCircle`, `bumpMemberCount`, `togglePostReaction`
  (actions/circle-detail.ts). Circle reads can already go through the API
  behind a switch; writes in this file are still direct.
- Campfire: `conversationsCollection` / `messagesCollection` via
  `postCampfireMessage`; `ensurePairedConversation`, `appendSystemMessage`
  (campfire.ts).

Cross-product mirrors (never throw, by contract)

- `plannerReservationsCollection`: `upsertEventReservation`,
  `cancelEventReservation` (planner.ts).
- Campfire mirror of event updates (campfire.ts).

Platform and operational

- `usageCountersCollection`: `consumeDailyUsage` (API write metering).
- `platformSettingsCollection`: `savePlatformSettings` (no caller in this
  repo; presumably the admin app).
- `feedbackCollection`: `recordFeedback`.
- `eventEmbeddingsCollection`: `indexEventEmbedding`, `removeEventEmbedding`.
- Shamwari tool-usage logging (`src/lib/shamwari.ts`).

## 3. What the Nyuchi API already does

Not assessed here: the API repository is outside this session's scope. To fill
in before any cut-over, for each row in section 1 record whether the API has an
equivalent, and whether it matches these points:

- upsert key and idempotency (replay and out-of-order delivery);
- field-level rules (picture and verified flag not clobbered; stub person for
  an unseen membership; soft delete, never create on delete);
- retry contract (non-2xx means WorkOS or the caller retries);
- who may call it (service credential vs the signed-in person's token).

This app already calls the API as a service and as the signed-in person
(`src/lib/nyuchi-api/client.ts`: `asService`, `asPerson`), for analytics,
community stats, and circles.

## 4. Can the lazy sync and the callback upsert call the API?

Likely yes, with two conditions.

- Callback `onSuccess` already tolerates failure (log and continue). Replacing
  the direct upsert with an API call keeps that contract. Latency on sign-in
  rises by one network hop; keep a short timeout.
- Lazy `resolveActingPerson` is on the read path of many actions and needs a
  person document to exist before it proceeds. If the API is slow or down, the
  fallback must not be "no person"; keep a bounded retry, then fail the action
  with a clear message rather than writing locally (a local fallback recreates
  the two-writer problem).

Bearer callers (the MCP server) deliberately do not create persons; they ask
the person to sign in once. That stays as is.

## 5. Secrets and deployment (names only)

Read by the app (see `.env.example` for the documented set):

- WorkOS: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`,
  `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `WORKOS_WEBHOOK_SECRET` (read only in
  `src/app/api/webhooks/workos/route.ts`), `WORKOS_MCP_CLIENT_ID`; optional
  `WORKOS_API_HOSTNAME`, `WORKOS_ISSUER`, `WORKOS_AUTHKIT_DOMAIN`.
- Data: `MONGODB_URI`.
- Storage: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET`, `NEXT_PUBLIC_ASSETS_URL`.
- Email: `RESEND_API_KEY`, `FEEDBACK_INBOX`.
- AI: `SHAMWARI_AI_GATEWAY_URL`, `SHAMWARI_AI_GATEWAY_TOKEN`,
  `SHAMWARI_AI_GATEWAY_AUTH_TOKEN`, `SHAMWARI_EMBEDDING_MODEL`,
  `SHAMWARI_GENERATION_MODEL`.
- Nyuchi API / platform: `NEXT_PUBLIC_API_URL`, `EDGE_AUTH_SECRET`,
  `VIEW_VISITOR_KEY_SECRET`, `FUNDI_API_TOKEN`, `FUNDI_INGESTION_URL`.
- Site and admin: `NEXT_PUBLIC_SITE_URL`, `ADMIN_URL`.
- Local only: `DEV_AUTH_BYPASS`, `NEXT_PUBLIC_DEV_AUTH_BYPASS`.

Deployment: Vercel, auto-deploying every push (per `AGENTS.md`). The repo has
`vercel.json` (one host redirect) and no committed `.vercel` project settings,
so environment variables live in the Vercel project, not in the repo. GitHub
workflows: `ci.yml`, `lint.yml`, `staging-version.yml`.

## 6. Proposed cut-over order

Principle: one writer at a time per concern, with the switch controlled by a
single flag, and verification before each step.

1. **Parity first (API side, no traffic).** The API implements the section 1
   semantics, with tests that replay WorkOS fixtures including duplicates,
   out-of-order membership-before-user, and delete-for-unknown-user.
2. **Shadow compare (still one writer).** Keep this app as the only writer.
   Add a read-only comparison job that reads both sides for a sample of
   persons and reports drift. No writes from the API yet.
3. **Move the webhook first.** Point the WorkOS webhook endpoint at the API
   (new endpoint, new signing secret held by the API). In this app set a flag
   so the webhook route returns 200 without writing. Do it in this order to
   avoid a gap: enable the API endpoint in WorkOS alongside the old one, then
   flip the flag here. Both receive events briefly, but only the API writes.
   Because the handlers are idempotent upserts keyed on the same ids, an
   accidental overlap is harmless; a gap is not, so never disable the old
   endpoint before the API endpoint has acknowledged events.
4. **Move the callback upsert.** Replace `syncPersonFromWorkos` in
   `onSuccess` with the API call behind the same flag; keep swallow-and-log.
5. **Move the lazy sync.** Replace the copies of `resolveActingPerson` with the
   single shared helper first (a refactor with no behaviour change), then make
   that one helper call the API.
6. **Retire.** After a clean period with zero drift: delete the direct sync
   functions and the webhook route here, remove `WORKOS_WEBHOOK_SECRET` from the
   Vercel project, and make the identity collections read-only for this app's
   database credential (the platform owns the collections).
7. **Rollback at every step** is the flag: flipping it back restores the local
   writer, because the old code stays until step 6.

Other direct writers in section 2 (events, RSVPs, circles, chat, and so on) are
a separate, larger migration and should be sequenced after identity.

## 7. What the API still needs

To be confirmed against its code; likely items:

- A WorkOS webhook receiver with signature verification and a replay window.
- Idempotent person and membership endpoints with the section 1 semantics.
- A stub-person path for membership events that arrive before `user.created`.
- A service credential for this app's callback and lazy sync, scoped to
  person provisioning only.
- A drift-report endpoint or job for step 2.
- Latency and availability targets, since sign-in will depend on it.
