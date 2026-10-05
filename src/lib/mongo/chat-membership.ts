/**
 * Who may use an event's or a calendar's paired Campfire chat (server-only).
 *
 * These chats had no membership model (#164): anyone signed in could open
 * and read them. The rules match the Nyuchi API's paired-conversation
 * contract (nyuchi/api-gateway#232), so moving these chats onto
 * `POST /v1/events/{id}/conversation` and `POST /v1/calendars/{id}/conversation`
 * later changes no one's access:
 *
 * - **Event chat and announcements:** the event's hosts (an active founder,
 *   admin, manager or representative membership on a host entity, or that
 *   entity's founder) and its attendees (an RSVP "yes", or a check-in). A
 *   "maybe" or "no" is not an attendee.
 * - **Calendar chat:** the calendar's owner and its active followers.
 *
 * Fail closed: a missing or inactive event or calendar, or any error, is
 * "not a member".
 */

import "server-only";
import {
  calendarsCollection,
  checkInsCollection,
  entitiesCollection,
  eventsCollection,
  rsvpsCollection,
} from "./databases";
import { listHostEntitiesForPerson } from "./entities";
import { isFollowingCalendar } from "./calendars";

/** True when the person hosts the event (through a host entity). */
export async function isEventHost(
  eventId: string,
  personId: string,
): Promise<boolean> {
  const event = await (
    await eventsCollection()
  ).findOne(
    { _id: eventId },
    { projection: { primaryHostEntityId: 1, hostEntityIds: 1 } },
  );
  if (!event) return false;
  const hostEntityIds = [
    event.primaryHostEntityId,
    ...(event.hostEntityIds ?? []),
  ].filter(Boolean);
  if (hostEntityIds.length === 0) return false;

  const hostable = new Set(
    (await listHostEntitiesForPerson(personId)).map((e) => e._id),
  );
  if (hostEntityIds.some((id) => hostable.has(id))) return true;

  const founded = await (
    await entitiesCollection()
  ).findOne(
    { _id: { $in: hostEntityIds }, founderPersonId: personId },
    { projection: { _id: 1 } },
  );
  return founded !== null;
}

/** True when the person said yes to the event, or checked in. */
export async function isEventAttendee(
  eventId: string,
  personId: string,
): Promise<boolean> {
  const [rsvp, checkIn] = await Promise.all([
    (await rsvpsCollection()).findOne(
      {
        eventId,
        attendeePersonId: personId,
        rsvpResponse: "RsvpResponseYes",
      },
      { projection: { _id: 1 } },
    ),
    (await checkInsCollection()).findOne(
      { eventId, attendeePersonId: personId },
      { projection: { _id: 1 } },
    ),
  ]);
  return rsvp !== null || checkIn !== null;
}

/** Hosts and attendees: who may open and use an event's chats. */
export async function isEventChatMember(
  eventId: string,
  personId: string | null,
): Promise<boolean> {
  if (!eventId || !personId) return false;
  try {
    return (
      (await isEventAttendee(eventId, personId)) ||
      (await isEventHost(eventId, personId))
    );
  } catch (err) {
    console.warn("[mukoko] isEventChatMember failed:", err);
    return false;
  }
}

/** The owner and active followers: who may use a calendar's chat. */
export async function isCalendarChatMember(
  calendarId: string,
  personId: string | null,
): Promise<boolean> {
  if (!calendarId || !personId) return false;
  try {
    const calendar = await (
      await calendarsCollection()
    ).findOne(
      { _id: calendarId, isActive: true },
      { projection: { ownerPersonId: 1 } },
    );
    if (!calendar) return false;
    if (calendar.ownerPersonId === personId) return true;
    return await isFollowingCalendar(calendarId, personId);
  } catch (err) {
    console.warn("[mukoko] isCalendarChatMember failed:", err);
    return false;
  }
}
