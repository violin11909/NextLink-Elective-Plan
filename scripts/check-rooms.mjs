#!/usr/bin/env node
/**
 * Tests for the room-list rules in lib/rooms.ts.
 *
 * The room list stopped being a constant the day it became editable, and the
 * rules that keep it honest are the kind that fail quietly: an override left
 * behind on a deleted room, an id that collides with one hidden from view, a
 * booking saved in a different order and read back as a different plan. Each
 * case below is one of those. `node --experimental-strip-types` runs the
 * TypeScript sources directly — no build step, no test framework.
 */
import { readFileSync } from "node:fs";
import {
  EMPTY_ROOM_EDITS,
  addRoom,
  bookingAt,
  deleteRoom,
  makeRoomId,
  mergeRooms,
  patchRoom,
  setRoomBlocked,
  validateRoomDraft,
} from "../lib/rooms.ts";

let failures = 0;
const check = (name, fn) => {
  try {
    const problem = fn();
    if (problem) {
      failures += 1;
      console.error(`  ✗ ${name}\n      ${problem}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}\n      threw: ${error.message}`);
  }
};

const room = (id, over = {}) => ({
  id,
  name: over.name ?? `ห้อง ${id}`,
  building: over.building ?? "จุฬาพัฒน์ 4",
  floor: over.floor ?? "1",
  seats: over.seats ?? 40,
  seatsIsEstimated: over.seatsIsEstimated ?? false,
  tier: over.tier ?? "READY",
  blockedSlots: over.blockedSlots ?? [],
});

const draft = (over = {}) => ({
  name: over.name ?? "ตึกร้อยปี ห้อง 406",
  building: over.building ?? "ตึกร้อยปี (คณะวิศวะ)",
  floor: over.floor ?? "4",
  seats: over.seats ?? 50,
  seatsIsEstimated: over.seatsIsEstimated ?? true,
  tier: over.tier ?? "NEEDS_APPROVAL",
});

const SEED = [room("cp4-1f"), room("cp5-203"), room("eng3-405", { tier: "NEEDS_APPROVAL" })];

/* ---- the seed data itself -------------------------------------------- */

check("every seeded room has a unique id and a usable seat count", () => {
  const rooms = JSON.parse(readFileSync("data/plan-rooms.json", "utf8")).rooms;
  const ids = new Set(rooms.map((item) => item.id));
  if (ids.size !== rooms.length) return "two rooms share an id";
  const bad = rooms.find((item) => !Number.isInteger(item.seats) || item.seats < 1);
  if (bad) return `${bad.id} has ${bad.seats} seats`;
  // An unconfirmed capacity has to say so, or the scheduler treats a guess as
  // a measurement — see docs/data-model.md.
  const guessed = rooms.filter((item) => item.tier === "NEEDS_APPROVAL" && !item.seatsIsEstimated);
  return guessed.length === 0 ? null : `${guessed.map((item) => item.id).join(", ")} claim a confirmed capacity`;
});

/* ---- merging --------------------------------------------------------- */

check("with no edits the seed comes back untouched, in order", () => {
  const merged = mergeRooms(SEED, EMPTY_ROOM_EDITS);
  return merged.map((item) => item.id).join(",") === "cp4-1f,cp5-203,eng3-405" ? null : "order or contents changed";
});

check("an override changes the room without touching the seed", () => {
  const edits = patchRoom(EMPTY_ROOM_EDITS, "cp5-203", { seats: 90, tier: "NEEDS_APPROVAL" });
  const merged = mergeRooms(SEED, edits);
  const found = merged.find((item) => item.id === "cp5-203");
  if (found.seats !== 90 || found.tier !== "NEEDS_APPROVAL") return "the override did not apply";
  if (SEED[1].seats !== 40) return "the seed array was mutated";
  return found.name === SEED[1].name ? null : "fields nobody edited were lost";
});

check("a removed seed room is hidden, and comes back when the removal goes", () => {
  const edits = deleteRoom(EMPTY_ROOM_EDITS, "cp4-1f");
  if (mergeRooms(SEED, edits).some((item) => item.id === "cp4-1f")) return "the room is still listed";
  return mergeRooms(SEED, EMPTY_ROOM_EDITS).length === 3 ? null : "the seed did not survive the removal";
});

check("an added room is listed after the seed and is editable in place", () => {
  const { edits, id } = addRoom(EMPTY_ROOM_EDITS, draft(), SEED.map((item) => item.id));
  const patched = patchRoom(edits, id, { seats: 55 });
  if (Object.keys(patched.overrides).length > 0) return "an added room collected an override instead of being edited";
  const merged = mergeRooms(SEED, patched);
  if (merged.length !== 4 || merged[3].id !== id) return "the added room is missing or out of order";
  return merged[3].seats === 55 ? null : "the edit did not apply";
});

check("deleting a room forgets what was typed about it", () => {
  const withOverride = patchRoom(EMPTY_ROOM_EDITS, "cp5-203", { seats: 90 });
  const deleted = deleteRoom(withOverride, "cp5-203");
  if (deleted.overrides["cp5-203"]) return "a deleted room kept its override";
  const added = addRoom(EMPTY_ROOM_EDITS, draft(), []);
  const gone = deleteRoom(added.edits, added.id);
  if (gone.added.length !== 0) return "an added room was hidden rather than forgotten";
  return gone.removed.includes(added.id) ? "an added room was also recorded as removed" : null;
});

check("removing the same room twice does not queue it twice", () => {
  const once = deleteRoom(EMPTY_ROOM_EDITS, "cp4-1f");
  const twice = deleteRoom(once, "cp4-1f");
  return twice.removed.length === 1 ? null : `removed is ${JSON.stringify(twice.removed)}`;
});

/* ---- ids and validation ---------------------------------------------- */

check("ids are ASCII, derived from the name, and never collide", () => {
  const first = makeRoomId(draft({ name: "ตึกร้อยปี ห้อง 406", building: "ตึกร้อยปี (คณะวิศวะ)" }), []);
  if (!/^[a-z0-9-]+$/.test(first)) return `not a plain ASCII id: ${first}`;
  if (!first.includes("406")) return `the room number is missing from ${first}`;
  const second = makeRoomId(draft({ name: "ตึกร้อยปี ห้อง 406", building: "ตึกร้อยปี (คณะวิศวะ)" }), [first]);
  if (second === first) return "two rooms were given the same id";
  if (!/[a-z]/.test(first)) return `an id of digits alone reads as a page number: ${first}`;
  const noAscii = makeRoomId(draft({ name: "ห้องประชุมใหญ่", building: "อาคารเรียนรวม" }), []);
  return /^[a-z0-9-]+$/.test(noAscii) ? null : `a name with no ASCII produced ${noAscii}`;
});

check("an id is kept clear of rooms that are currently hidden", () => {
  // The room comes back with "คืนค่าเริ่มต้น", and two rooms on one id would
  // then be one room wearing two names.
  const taken = SEED.map((item) => item.id);
  const id = makeRoomId(draft({ name: "ห้อง cp4 1f", building: "" }), taken);
  return taken.includes(id) ? `reused ${id}` : null;
});

check("the form refuses what the data model cannot carry", () => {
  const cases = [
    [draft({ name: "  " }), "a nameless room"],
    [draft({ building: "" }), "a room in no building"],
    [draft({ floor: "" }), "a room on no floor"],
    [draft({ seats: 0 }), "a room with no seats"],
    [draft({ seats: 4000 }), "a room with more seats than the faculty has students"],
    [draft({ seats: Number.NaN }), "a seat count that is not a number"],
  ];
  for (const [input, what] of cases) {
    if (!validateRoomDraft(input, SEED)) return `${what} was accepted`;
  }
  return validateRoomDraft(draft(), SEED) === null ? null : "a good room was refused";
});

check("two rooms cannot share a name in one building, but may across buildings", () => {
  const rooms = [...SEED, room("eng100-405", { name: "ห้อง 405", building: "ตึกร้อยปี (คณะวิศวะ)" })];
  const clash = validateRoomDraft(draft({ name: "ห้อง 405", building: "ตึกร้อยปี (คณะวิศวะ)" }), rooms);
  if (!clash) return "a duplicate name in the same building was accepted";
  const other = validateRoomDraft(draft({ name: "ห้อง 405", building: "ตึก 3 (คณะวิศวะ)" }), rooms);
  if (other) return `the same number in another building was refused: ${other}`;
  // Editing a room must not trip over its own name.
  return validateRoomDraft(draft({ name: "ห้อง 405", building: "ตึกร้อยปี (คณะวิศวะ)" }), rooms, "eng100-405") === null
    ? null
    : "a room could not be saved under the name it already has";
});

/* ---- bookings -------------------------------------------------------- */

check("a booking holds one period and says why", () => {
  const edits = setRoomBlocked(EMPTY_ROOM_EDITS, SEED[0], "TUE_AM", "  2110101 Com Prog  ");
  const merged = mergeRooms(SEED, edits);
  const found = merged.find((item) => item.id === "cp4-1f");
  if (found.blockedSlots.length !== 1) return `expected one booking, got ${found.blockedSlots.length}`;
  return bookingAt(found, "TUE_AM") === "2110101 Com Prog" ? null : "the reason was not stored as typed";
});

check("releasing a period removes it rather than blanking the reason", () => {
  const booked = mergeRooms(SEED, setRoomBlocked(EMPTY_ROOM_EDITS, SEED[0], "TUE_AM", "วิชาบังคับ"));
  const released = mergeRooms(SEED, setRoomBlocked(EMPTY_ROOM_EDITS, booked[0], "TUE_AM", null));
  if (released[0].blockedSlots.length !== 0) return "the period is still held";
  const blank = mergeRooms(SEED, setRoomBlocked(EMPTY_ROOM_EDITS, booked[0], "TUE_AM", "   "));
  return blank[0].blockedSlots.length === 0 ? null : "an all-space reason was stored as a booking";
});

check("re-booking a held period replaces it, and bookings stay in week order", () => {
  let edits = setRoomBlocked(EMPTY_ROOM_EDITS, SEED[0], "THU_PM", "สอบกลางภาค");
  let merged = mergeRooms(SEED, edits);
  edits = setRoomBlocked(edits, merged[0], "MON_AM", "วิชาบังคับ");
  merged = mergeRooms(SEED, edits);
  edits = setRoomBlocked(edits, merged[0], "THU_PM", "งานของคณะ");
  merged = mergeRooms(SEED, edits);
  const held = merged[0].blockedSlots;
  if (held.length !== 2) return `expected two bookings, got ${held.length}`;
  if (held.map((entry) => entry.slotId).join(",") !== "MON_AM,THU_PM") return "bookings are not in week order";
  return bookingAt(merged[0], "THU_PM") === "งานของคณะ" ? null : "the second booking did not replace the first";
});

if (failures) {
  console.error(`\nrooms: ${failures} failing check(s)`);
  process.exit(1);
}
console.log("rooms: ok (14 checks)");
