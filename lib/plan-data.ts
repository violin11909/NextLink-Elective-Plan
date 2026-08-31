import coursesJson from "@/data/plan-courses.json";
import roomsJson from "@/data/plan-rooms.json";
import { ALL_SLOTS, isSlotId, slotRank, type SlotId } from "./slots.ts";
import type { PlanCourse, PlanPayload, PlanRoom } from "./plan-types.ts";

/**
 * The one place that knows where plan data comes from.
 *
 * The JSON imports use the `@/` alias, which only Next resolves — this module
 * is therefore the one file in lib/ that plain node cannot load. Everything the
 * scheduler tests need (slots, types, scheduler, conflicts) imports its
 * siblings relatively so `node --experimental-strip-types` can run them
 * directly, with no bundler and no loader shim.
 *
 * Today it is two JSON files bundled with the app. When this moves to a
 * database, only this file changes — every component above it takes a
 * `PlanPayload` and has no opinion about its origin.
 */

/**
 * Reject an unknown slot id at load time rather than at render time.
 *
 * A typo like "WED_MORNING" in the seed file is invisible until a grid tries
 * to look it up and quietly shows the course nowhere at all. Failing here
 * names the file, the course and the value.
 */
function readSlots(where: string, values: unknown): SlotId[] {
  if (!Array.isArray(values)) throw new Error(`${where}: availability must be an array`);
  const slots: SlotId[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !isSlotId(value)) {
      throw new Error(`${where}: unknown slot "${String(value)}" (expected one of ${ALL_SLOTS.join(", ")})`);
    }
    if (!slots.includes(value)) slots.push(value);
  }
  // Sorted so two courses offering the same periods in different order behave
  // identically — the scheduler's tie-breaks read this list in order.
  return slots.sort((a, b) => slotRank(a) - slotRank(b));
}

function readRoom(raw: (typeof roomsJson)["rooms"][number]): PlanRoom {
  return {
    id: raw.id,
    name: raw.name,
    building: raw.building,
    floor: raw.floor,
    seats: raw.seats,
    seatsIsEstimated: raw.seatsIsEstimated,
    tier: raw.tier === "NEEDS_APPROVAL" ? "NEEDS_APPROVAL" : "READY",
    blockedSlots: raw.blockedSlots.map((blocked) => {
      if (!isSlotId(blocked.slotId)) {
        throw new Error(`room ${raw.id}: unknown blocked slot "${blocked.slotId}"`);
      }
      return { slotId: blocked.slotId, reason: blocked.reason };
    }),
  };
}

function readCourse(raw: (typeof coursesJson)["courses"][number]): PlanCourse {
  const availability = readSlots(`course ${raw.courseCode}`, raw.availability);
  if (raw.sessionsPerWeek > availability.length) {
    throw new Error(
      `course ${raw.courseCode}: needs ${raw.sessionsPerWeek} periods a week but only offers ${availability.length}`,
    );
  }
  return {
    id: raw.id,
    courseCode: raw.courseCode,
    title: raw.title,
    category: raw.category,
    provider: raw.provider,
    instructor: raw.instructor,
    coordinator: raw.coordinator ?? null,
    deliveryMode: raw.deliveryMode === "ONLINE" ? "ONLINE" : raw.deliveryMode === "HYBRID" ? "HYBRID" : "ON_SITE",
    availability,
    sessionsPerWeek: raw.sessionsPerWeek,
    minSeats: raw.minSeats,
    capacity: raw.capacity,
    weeks: raw.weeks,
    notes: raw.notes ?? null,
  };
}

export function getPlanPayload(): PlanPayload {
  const rooms = roomsJson.rooms.map(readRoom);
  const courses = coursesJson.courses.map(readCourse);

  const roomIds = new Set(rooms.map((room) => room.id));
  if (roomIds.size !== rooms.length) throw new Error("data/plan-rooms.json: duplicate room id");
  const courseIds = new Set(courses.map((course) => course.id));
  if (courseIds.size !== courses.length) throw new Error("data/plan-courses.json: duplicate course id");

  return {
    dataset: coursesJson.dataset,
    lastUpdated: coursesJson.lastUpdated,
    timezone: coursesJson.timezone,
    isMock: coursesJson.isMock,
    courses,
    rooms,
  };
}
