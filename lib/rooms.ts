import type { PlanRoom, RoomTier } from "./plan-types.ts";
import { slotRank, type SlotId } from "./slots.ts";

/**
 * The room list as a person edits it: the bundled rooms, plus what they added,
 * minus what they removed, with their edits laid over the rest.
 *
 * Rooms used to be a fixed fact from `data/plan-rooms.json`. They are not: the
 * department gets a floor of ตึกร้อยปี one term and loses a room the next, and
 * waiting for a code change to record that means the planner is wrong for as
 * long as it takes. So edits live beside the seed rather than in it — the file
 * stays the department's shared starting point, and "คืนค่าเริ่มต้น" is
 * always a way back to it.
 *
 * Everything here is a pure function over that state, so the rules can be
 * tested without a browser — see scripts/check-rooms.mjs. `use-plan-state`
 * only decides when to call them and where to keep the result.
 */

export type RoomOverride = Partial<
  Pick<PlanRoom, "name" | "building" | "floor" | "seats" | "seatsIsEstimated" | "tier" | "blockedSlots">
>;

/**
 * Three separate pieces rather than one list of rooms, because they answer to
 * different owners: `added` is entirely a person's, `overrides` and `removed`
 * are their corrections *to the seed* — which means a seeded room that changes
 * in a later release still picks up everything the person did not touch.
 */
export type RoomEdits = {
  overrides: Record<string, RoomOverride>;
  added: PlanRoom[];
  removed: string[];
};

export const EMPTY_ROOM_EDITS: RoomEdits = { overrides: {}, added: [], removed: [] };

/** What the form collects. The id, and the bookings, are not a person's to type. */
export type RoomDraft = {
  name: string;
  building: string;
  floor: string;
  seats: number;
  seatsIsEstimated: boolean;
  tier: RoomTier;
};

/** Rooms are 18 periods a week; a number far above that is a typo, not a hall. */
const MAX_SEATS = 2000;

export function roomDraftFrom(room: PlanRoom): RoomDraft {
  return {
    name: room.name,
    building: room.building,
    floor: room.floor,
    seats: room.seats,
    seatsIsEstimated: room.seatsIsEstimated,
    tier: room.tier,
  };
}

/**
 * One message, or null. Returning the first problem rather than a list keeps
 * the dialog from turning into a wall of red for a form with five fields —
 * the reader fixes one thing and the next one appears if it is still wrong.
 */
export function validateRoomDraft(draft: RoomDraft, rooms: PlanRoom[], editingId?: string): string | null {
  if (!draft.name.trim()) return "ต้องมีชื่อห้อง";
  if (!draft.building.trim()) return "ต้องระบุอาคาร";
  if (!draft.floor.trim()) return "ต้องระบุชั้น";
  if (!Number.isFinite(draft.seats) || !Number.isInteger(draft.seats)) return "จำนวนที่นั่งต้องเป็นจำนวนเต็ม";
  if (draft.seats < 1) return "จำนวนที่นั่งต้องมากกว่า 0";
  if (draft.seats > MAX_SEATS) return `จำนวนที่นั่งดูมากผิดปกติ (เกิน ${MAX_SEATS})`;
  const clash = rooms.find(
    (room) => room.id !== editingId && room.name.trim() === draft.name.trim() && room.building.trim() === draft.building.trim(),
  );
  if (clash) return `มีห้องชื่อนี้ในอาคารนี้อยู่แล้ว (${clash.name})`;
  return null;
}

/**
 * An id from the name, ASCII only.
 *
 * The id is a URL — `/rooms/<id>` — and a Thai one survives a copy-paste into
 * chat as a line of percent-escapes. Room names carry their number in ASCII
 * ("ห้อง 18-16", "ห้อง A ชั้น 3"), so that part is enough to tell rooms apart;
 * when a name has no ASCII at all the id falls back to a counter, which is
 * ugly in the address bar but never collides.
 */
export function makeRoomId(draft: RoomDraft, taken: Iterable<string>): string {
  const used = new Set(taken);
  const ascii = `${draft.building} ${draft.name}`
    .replace(/[^\x20-\x7e]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A bare number makes an address that reads like a page number — `/rooms/406`
  // — so an id with no letters in it gets told what it is.
  const base = !ascii ? "room" : /[a-z]/.test(ascii) ? ascii : `room-${ascii}`;
  if (!used.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The rooms as they are now. Order: the seed's, then whatever was added. */
export function mergeRooms(seed: PlanRoom[], edits: RoomEdits): PlanRoom[] {
  const removed = new Set(edits.removed);
  const apply = (room: PlanRoom): PlanRoom => {
    const override = edits.overrides[room.id];
    return override ? { ...room, ...override } : room;
  };
  return [...seed.map(apply), ...edits.added.map(apply)].filter((room) => !removed.has(room.id));
}

export function addRoom(edits: RoomEdits, draft: RoomDraft, taken: Iterable<string>): { edits: RoomEdits; id: string } {
  const id = makeRoomId(draft, taken);
  const room: PlanRoom = {
    id,
    name: draft.name.trim(),
    building: draft.building.trim(),
    floor: draft.floor.trim(),
    seats: draft.seats,
    seatsIsEstimated: draft.seatsIsEstimated,
    tier: draft.tier,
    blockedSlots: [],
  };
  return { edits: { ...edits, added: [...edits.added, room] }, id };
}

/**
 * Patch a room, writing to whichever half of the state owns it.
 *
 * A room a person added is theirs outright, so the patch lands on the room
 * itself; a seeded room keeps its seed and collects an override. Writing an
 * override for an added room would work too, and would leave two records of
 * one room to disagree the first time either is edited.
 */
export function patchRoom(edits: RoomEdits, roomId: string, patch: RoomOverride): RoomEdits {
  if (edits.added.some((room) => room.id === roomId)) {
    return { ...edits, added: edits.added.map((room) => (room.id === roomId ? { ...room, ...patch } : room)) };
  }
  return { ...edits, overrides: { ...edits.overrides, [roomId]: { ...(edits.overrides[roomId] ?? {}), ...patch } } };
}

/**
 * Remove a room. An added room is forgotten; a seeded one is hidden.
 *
 * Hiding rather than deleting is what makes the seed file the shared truth: a
 * person who removes a room they should not have gets it back from "คืนค่า
 * เริ่มต้น", and the next person to open the app on another machine still sees
 * the department's own list.
 */
export function deleteRoom(edits: RoomEdits, roomId: string): RoomEdits {
  const overrides = { ...edits.overrides };
  delete overrides[roomId];
  if (edits.added.some((room) => room.id === roomId)) {
    return { overrides, added: edits.added.filter((room) => room.id !== roomId), removed: edits.removed };
  }
  return {
    overrides,
    added: edits.added,
    removed: edits.removed.includes(roomId) ? edits.removed : [...edits.removed, roomId],
  };
}

/**
 * Book a period in a room for something that is not an elective, or release
 * one. `reason` is what the cell will say — "2110101 Com Prog", "สอบกลางภาค".
 *
 * These are the same `blockedSlots` the scheduler has always honoured, so a
 * booking made here is a period `planSchedule` will not touch and a drop the
 * board will not take. A note that did not hold the period would be a note
 * that gets planned over, which is the thing this is for.
 */
export function setRoomBlocked(edits: RoomEdits, room: PlanRoom, slotId: SlotId, reason: string | null): RoomEdits {
  const others = room.blockedSlots.filter((entry) => entry.slotId !== slotId);
  const trimmed = reason?.trim();
  const next = trimmed ? [...others, { slotId, reason: trimmed }] : others;
  // Sorted so the same set of bookings is always stored the same way, whatever
  // order they were made in.
  next.sort((a, b) => slotRank(a.slotId) - slotRank(b.slotId));
  return patchRoom(edits, room.id, { blockedSlots: next });
}

/** Read one room's booking for a period, if it has one. */
export function bookingAt(room: PlanRoom, slotId: SlotId): string | null {
  return room.blockedSlots.find((entry) => entry.slotId === slotId)?.reason ?? null;
}
