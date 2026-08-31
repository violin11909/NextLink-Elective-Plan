#!/usr/bin/env node
/**
 * The scheduler's tests.
 *
 * This is the one part of the planner with a right answer, so it is the one
 * part worth pinning down before any of it reaches a screen. Each case below
 * is a rule someone would notice being broken: a company placed outside the
 * hours it offered, a locked class quietly moved, a room double-booked across
 * a period boundary. `node --experimental-strip-types` runs the TypeScript
 * sources directly — no build step, no test framework.
 */
import { readFileSync } from "node:fs";
import { autoAssign, planSchedule, explainFailure } from "../lib/scheduler.ts";
import { detectConflicts } from "../lib/conflicts.ts";

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

const course = (over) => ({
  id: over.id,
  courseCode: over.id,
  title: over.title ?? over.id,
  category: over.category ?? "หมวดทดสอบ",
  provider: over.provider ?? over.id,
  instructor: over.instructor ?? `ผู้สอน-${over.id}`,
  coordinator: null,
  deliveryMode: over.deliveryMode ?? "ON_SITE",
  availability: over.availability,
  sessionsPerWeek: over.sessionsPerWeek ?? 1,
  minSeats: over.minSeats ?? 20,
  capacity: over.capacity ?? over.minSeats ?? 20,
  weeks: 10,
  notes: null,
});

const room = (id, seats, tier = "READY", blockedSlots = []) => ({
  id,
  name: id,
  building: tier === "READY" ? "จุฬาพัฒน์" : "ตึก 4",
  floor: "1",
  seats,
  seatsIsEstimated: false,
  tier,
  blockedSlots,
});

const slotOf = (result, id) => result.assignments.find((a) => a.courseId === id)?.slotId;
const roomOf = (result, id) => result.assignments.find((a) => a.courseId === id)?.roomId;

console.log("scheduler:");

// 1 — the original problem, and the reason the ordering is most-constrained-first.
check("a company free in one period only always gets that period", () => {
  const rooms = [room("r1", 50)];
  const tight = course({ id: "A", availability: ["WED_AM"] });
  const loose = course({ id: "B", availability: ["WED_AM", "FRI_EVE"] });
  for (const order of [[tight, loose], [loose, tight]]) {
    const result = autoAssign({ courses: order, rooms });
    if (slotOf(result, "A") !== "WED_AM") {
      return `input order ${order.map((c) => c.id).join(",")} put A at ${slotOf(result, "A")}`;
    }
  }
  return null;
});

// 2 — the other half of it: the flexible one moves, and is still placed.
check("the flexible company is pushed to its fallback, not dropped", () => {
  const rooms = [room("r1", 50)];
  const result = autoAssign({
    courses: [course({ id: "A", availability: ["WED_AM"] }), course({ id: "B", availability: ["WED_AM", "FRI_EVE"] })],
    rooms,
  });
  if (slotOf(result, "B") !== "FRI_EVE") return `B landed at ${slotOf(result, "B")}`;
  if (result.unassigned.length) return `unexpectedly unassigned: ${result.unassigned.map((u) => u.courseId)}`;
  return null;
});

// 3 — if this ever breaks, nobody will press the button again.
check("a locked assignment is never moved or dropped", () => {
  const rooms = [room("r1", 50), room("r2", 50)];
  const locked = {
    id: "locked-1",
    courseId: "A",
    slotId: "WED_AM",
    roomId: "r2",
    startTime: "09:00",
    endTime: "12:00",
    locked: true,
    source: "MANUAL",
  };
  const result = autoAssign({
    courses: [
      course({ id: "A", availability: ["WED_AM", "MON_AM"] }),
      course({ id: "B", availability: ["WED_AM"] }),
      course({ id: "C", availability: ["WED_AM"] }),
    ],
    rooms,
    locked: [locked],
  });
  const kept = result.assignments.find((a) => a.id === "locked-1");
  if (!kept) return "the locked assignment disappeared";
  if (kept.slotId !== "WED_AM" || kept.roomId !== "r2") return `moved to ${kept.slotId}/${kept.roomId}`;
  return null;
});

// 4 — a plan that reshuffles itself between identical runs cannot be trusted.
check("planning the same input twice gives the identical plan", () => {
  const rooms = [room("r1", 60), room("r2", 40), room("r3", 30)];
  const courses = [
    course({ id: "A", availability: ["WED_AM", "THU_AM"], minSeats: 55 }),
    course({ id: "B", availability: ["WED_AM", "WED_PM"], minSeats: 35 }),
    course({ id: "C", availability: ["WED_AM", "THU_AM", "FRI_PM"], minSeats: 25 }),
    course({ id: "D", availability: ["THU_AM", "FRI_PM"], minSeats: 25, sessionsPerWeek: 2 }),
  ];
  const a = JSON.stringify(planSchedule({ courses, rooms }));
  const b = JSON.stringify(planSchedule({ courses, rooms }));
  return a === b ? null : "two runs disagreed";
});

// 5 — an online class competing for rooms would crowd out one that needs them.
check("an ONLINE course takes no room and blocks nobody", () => {
  const rooms = [room("r1", 50)];
  const result = autoAssign({
    courses: [
      course({ id: "ONLINE", availability: ["WED_AM"], deliveryMode: "ONLINE", minSeats: 0 }),
      course({ id: "ONSITE", availability: ["WED_AM"] }),
    ],
    rooms,
  });
  if (roomOf(result, "ONLINE") !== null) return `online course got room ${roomOf(result, "ONLINE")}`;
  if (roomOf(result, "ONSITE") !== "r1") return "the on-site course lost the room";
  return null;
});

// 6 — refusing to place is fine; refusing to say why is not.
check("a course that cannot fit is reported with reasons, not placed anyway", () => {
  const rooms = [room("small", 20)];
  const result = autoAssign({ courses: [course({ id: "BIG", availability: ["WED_AM"], minSeats: 200 })], rooms });
  if (result.assignments.length !== 0) return "it was placed in a room that cannot hold it";
  const entry = result.unassigned.find((u) => u.courseId === "BIG");
  if (!entry) return "no unassigned entry";
  if (!entry.reason.perSlot.some((s) => s.blockers.includes("ROOM_TOO_SMALL"))) {
    return `blockers were ${JSON.stringify(entry.reason.perSlot)}`;
  }
  if (entry.reason.suggestions.length === 0) return "no suggestions offered";
  return null;
});

// 7 — the reason assignments carry real times and not just a period.
check("two classes overlapping across a period boundary are a conflict", () => {
  const courses = [course({ id: "A", availability: ["WED_AM"] }), course({ id: "B", availability: ["WED_PM"] })];
  const conflicts = detectConflicts({
    courses,
    rooms: [room("r1", 50)],
    assignments: [
      { id: "a", courseId: "A", slotId: "WED_AM", roomId: "r1", startTime: "09:00", endTime: "12:30", locked: true, source: "MANUAL" },
      { id: "b", courseId: "B", slotId: "WED_PM", roomId: "r1", startTime: "12:00", endTime: "15:00", locked: true, source: "MANUAL" },
    ],
  });
  return conflicts.some((c) => c.code === "ROOM_DOUBLE_BOOKED") ? null : "the overlap was not reported";
});

// 8 — the inverse, and the one a closed-interval overlap test gets wrong.
check("an afternoon and an evening class in one room do NOT clash at 16:00", () => {
  const courses = [course({ id: "A", availability: ["WED_PM"] }), course({ id: "B", availability: ["WED_EVE"] })];
  const conflicts = detectConflicts({
    courses,
    rooms: [room("r1", 50)],
    assignments: [
      { id: "a", courseId: "A", slotId: "WED_PM", roomId: "r1", startTime: "13:00", endTime: "16:00", locked: true, source: "MANUAL" },
      { id: "b", courseId: "B", slotId: "WED_EVE", roomId: "r1", startTime: "16:00", endTime: "19:00", locked: true, source: "MANUAL" },
    ],
  });
  const wrong = conflicts.filter((c) => c.code === "ROOM_DOUBLE_BOOKED");
  return wrong.length === 0 ? null : "16:00 was treated as an overlap";
});

// 9 — the guarantee that a weight could not have given.
check("no Faculty room is used while a จุฬาพัฒน์ room would fit", () => {
  const rooms = [room("cp-1", 50), room("cp-2", 50), room("eng-1", 50, "NEEDS_APPROVAL")];
  const result = planSchedule({
    courses: [
      course({ id: "A", availability: ["WED_AM"] }),
      course({ id: "B", availability: ["WED_AM"] }),
    ],
    rooms,
  });
  const used = result.assignments.map((a) => a.roomId);
  return used.includes("eng-1") ? `used the Faculty room anyway: ${used.join(",")}` : null;
});

// 10 — and the fallback still works when จุฬาพัฒน์ genuinely runs out.
check("when จุฬาพัฒน์ is full the Faculty rooms open and are flagged", () => {
  const rooms = [room("cp-1", 50), room("eng-1", 50, "NEEDS_APPROVAL")];
  const courses = [
    course({ id: "A", availability: ["WED_AM"] }),
    course({ id: "B", availability: ["WED_AM"] }),
  ];
  const result = planSchedule({ courses, rooms });
  if (result.assignments.length !== 2) return `only ${result.assignments.length} placed`;
  if (!result.assignments.some((a) => a.roomId === "eng-1")) return "the Faculty room was not used";
  const conflicts = detectConflicts({ courses, rooms, assignments: result.assignments });
  return conflicts.some((c) => c.code === "NEEDS_ROOM_APPROVAL") ? null : "no approval reminder was raised";
});

/*
 * 11 — the shipped demo data.
 *
 * One course in it (21105814) is deliberately unschedulable: its company offers
 * a single period and staffs it with the lecturer already teaching the other
 * course in that period, so the planner has to refuse it and say why. That is
 * the state the failure screen exists for, and it has to survive edits to the
 * seed. Everything else must still place cleanly.
 */
const UNPLACEABLE = "plan-21105814";

check("the bundled seed data plans, leaving only the deliberate failure case", () => {
  const rooms = JSON.parse(readFileSync("data/plan-rooms.json", "utf8")).rooms;
  const courses = JSON.parse(readFileSync("data/plan-courses.json", "utf8")).courses;
  const result = planSchedule({ courses, rooms });

  const ids = result.unassigned.map((u) => u.courseId);
  if (ids.length !== 1 || ids[0] !== UNPLACEABLE) {
    return `expected only ${UNPLACEABLE} unassigned, got [${ids.join(", ")}]`;
  }
  const reason = result.unassigned[0].reason;
  if (!reason.perSlot.some((s) => s.blockers.includes("INSTRUCTOR_BUSY"))) {
    return `the failure should name the busy lecturer, got ${JSON.stringify(reason.perSlot)}`;
  }
  const blocking = detectConflicts({ courses, rooms, assignments: result.assignments }).filter(
    (c) => c.severity === "BLOCKED",
  );
  if (blocking.length) return blocking.map((c) => `${c.code} — ${c.title}`).join("\n      ");

  const total = courses.reduce((sum, c) => sum + c.sessionsPerWeek, 0);
  const expected = total - courses.find((c) => c.id === UNPLACEABLE).sessionsPerWeek;
  if (result.assignments.length !== expected) return `placed ${result.assignments.length} of ${expected} sessions`;
  return null;
});

/*
 * 13 — the bug the seed above found.
 *
 * planSchedule runs twice, and the second run used to receive only the courses
 * that failed the first. The rules look courses up by id, so a locked
 * assignment belonging to a course outside that list resolved to nothing, and
 * the instructor and provider checks skipped it — putting one lecturer in two
 * rooms at the same hour. The room check missed it because the two rooms
 * differed.
 */
check("a lecturer already placed in pass 1 still blocks pass 2", () => {
  const rooms = [room("cp-1", 50), room("eng-1", 50, "NEEDS_APPROVAL")];
  const courses = [
    course({ id: "X", availability: ["WED_AM"], provider: "Acme", instructor: "อ.เดียวกัน" }),
    course({ id: "Y", availability: ["WED_AM"], provider: "Acme", instructor: "อ.เดียวกัน" }),
  ];
  const result = planSchedule({ courses, rooms });
  if (result.assignments.length !== 1) {
    return `both were placed at once: ${JSON.stringify(result.assignments.map((a) => [a.courseId, a.roomId]))}`;
  }
  if (result.unassigned.length !== 1) return `expected one unassigned, got ${result.unassigned.length}`;
  return null;
});

// 12 — explainFailure is a public entry point; the panel calls it directly.
check("explainFailure can be called on its own for a single course", () => {
  const rooms = [room("r1", 20)];
  const target = course({ id: "BIG", availability: ["WED_AM", "THU_AM"], minSeats: 100 });
  const reason = explainFailure({ course: target, courses: [target], rooms, placed: [] });
  if (reason.perSlot.length !== 2) return `expected both periods explained, got ${reason.perSlot.length}`;
  return null;
});

if (failures) {
  console.error(`\nscheduler: ${failures} failing check(s)`);
  process.exit(1);
}
console.log("scheduler: ok (13 checks)");
