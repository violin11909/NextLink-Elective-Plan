import { PERIODS, overlaps, parseSlotId, slotRank, type DayKey, type SlotId } from "./slots.ts";
import { DEFAULT_SCHEDULER_OPTIONS, teachingBlockers, type SchedulerOptions } from "./schedule-policy.ts";
import { nextAssignmentId } from "./assignments.ts";
export type { SchedulerOptions } from "./schedule-policy.ts";
import type {
  Assignment,
  BlockerCode,
  FailureReason,
  PlanCourse,
  PlanRoom,
  ScheduleResult,
  SlotFailure,
  Suggestion,
  Unassigned,
} from "./plan-types.ts";

/**
 * Turning a pile of company offers into a timetable.
 *
 * Everything here is a pure function of its arguments: no clock, no random, no
 * React. Pressing "plan it" twice on the same data must give the same plan
 * twice — a planner that reshuffles the week each time you look at it is one
 * nobody trusts enough to lock anything in. It also means the whole thing is
 * testable from a plain node script, which is what scripts/check-scheduler.mjs
 * does.
 */

/**
 * How much each preference is worth. All of them are preferences — the rules
 * that cannot be broken live in `blockersFor`, not here.
 *
 * Deliberately absent: any preference for จุฬาพัฒน์ over the Faculty of
 * Engineering buildings. That one is not a preference, and a weight can always
 * be outvoted by the rest of this table — a course could land in ตึก 4 to keep
 * a company's two classes on one day, and nobody could explain why. It is
 * enforced structurally instead, by running the whole placement twice; see
 * `planSchedule`.
 */
export const SCHEDULER_WEIGHTS = {
  /** One trip to campus, two classes taught. Worth a lot to a visiting team. */
  sameProviderSameDay: 40,
  /** Evening is the last resort: fewer students come. */
  daytimePeriod: 25,
  /** Same reasoning for Saturday, which is offered but should not be filled
   *  while weekdays are still open. */
  weekday: 20,
  /** Two courses in one category at one time = students can only take one. */
  avoidCategoryClash: 20,
  /** A 30-seat class in a 236-seat hall wastes the hall and feels empty. */
  roomFitsSnugly: 15,
  oversizedRoom: -30,
  /** Spread the week out rather than stacking six classes onto Wednesday. */
  balancedDayLoad: 10,
  /** A twice-a-week course wants its two periods on different days. */
  sameCourseSameDay: -50,
} as const;

const DEFAULTS = DEFAULT_SCHEDULER_OPTIONS;

/** What every rule below needs to look things up. Built once per run. */
type Ctx = {
  coursesById: Map<string, PlanCourse>;
  rooms: PlanRoom[];
  options: Required<SchedulerOptions>;
};

function makeCtx(courses: PlanCourse[], rooms: PlanRoom[], options?: SchedulerOptions): Ctx {
  return {
    coursesById: new Map(courses.map((course) => [course.id, course])),
    rooms,
    options: { ...DEFAULTS, ...options },
  };
}

export function defaultTimesFor(slotId: SlotId): { startTime: string; endTime: string } {
  const { period } = parseSlotId(slotId);
  return { startTime: PERIODS[period].start, endTime: PERIODS[period].end };
}

function dayOf(slotId: SlotId): DayKey {
  return parseSlotId(slotId).day;
}

/** ONLINE courses occupy no room, so every room rule is skipped for them. */
function needsRoom(course: PlanCourse): boolean {
  return course.deliveryMode !== "ONLINE";
}

/**
 * Every reason this course cannot take this (period, room) right now.
 *
 * Returns all of them rather than the first, because the failure message is
 * only useful if it says "the room is too small *and* the company is teaching
 * elsewhere" instead of whichever one happened to be checked first.
 */
function blockersFor(
  course: PlanCourse,
  slotId: SlotId,
  room: PlanRoom | null,
  placed: Assignment[],
  ctx: Ctx,
): BlockerCode[] {
  const found: BlockerCode[] = [];
  if (!course.availability.includes(slotId)) found.push("OUTSIDE_AVAILABILITY");
  if (needsRoom(course) && !room) found.push("NO_ROOM_AVAILABLE");

  const { startTime, endTime } = defaultTimesFor(slotId);
  const day = dayOf(slotId);
  const sameDay = placed.filter((item) => dayOf(item.slotId) === day);
  const clashing = sameDay.filter((item) => overlaps(startTime, endTime, item.startTime, item.endTime));

  if (room) {
    if (room.blockedSlots.some((blocked) => blocked.slotId === slotId)) found.push("ROOM_BLOCKED");
    if (room.seats < course.minSeats) found.push("ROOM_TOO_SMALL");
    if (clashing.some((item) => item.roomId === room.id)) found.push("ROOM_DOUBLE_BOOKED");
  }

  for (const item of clashing) {
    const other = ctx.coursesById.get(item.courseId);
    if (!other) continue;
    for (const code of teachingBlockers(course, other, ctx.options)) if (!found.includes(code)) found.push(code);
  }

  return found;
}

type Candidate = { slotId: SlotId; room: PlanRoom | null; score: number };

function scoreFor(course: PlanCourse, slotId: SlotId, room: PlanRoom | null, placed: Assignment[], ctx: Ctx): number {
  const w = SCHEDULER_WEIGHTS;
  const { day, period } = parseSlotId(slotId);
  let score = 0;

  const sameProviderSameDay = placed.some((item) => {
    const other = ctx.coursesById.get(item.courseId);
    return other && other.provider === course.provider && dayOf(item.slotId) === day;
  });
  if (sameProviderSameDay) score += w.sameProviderSameDay;

  if (period !== "EVE") score += w.daytimePeriod;
  if (day !== "SAT") score += w.weekday;

  const categoryClash = placed.some((item) => {
    const other = ctx.coursesById.get(item.courseId);
    return other && other.id !== course.id && other.category === course.category && item.slotId === slotId;
  });
  if (!categoryClash) score += w.avoidCategoryClash;

  if (room) {
    const slack = room.seats - Math.max(course.minSeats, 1);
    if (slack >= 0 && slack <= Math.max(course.minSeats, 1) * 0.3) score += w.roomFitsSnugly;
    if (room.seats >= Math.max(course.minSeats, 1) * 2) score += w.oversizedRoom;
  }

  const loadOnDay = placed.filter((item) => dayOf(item.slotId) === day).length;
  score += Math.round(w.balancedDayLoad * (1 - Math.min(loadOnDay, 6) / 6));

  if (placed.some((item) => item.courseId === course.id && dayOf(item.slotId) === day)) {
    score += w.sameCourseSameDay;
  }

  return score;
}

/**
 * Every placement this course could take right now, best first.
 *
 * Ties are broken by earliest period then by room order — never arbitrarily —
 * because that is what makes two runs of the planner agree.
 */
function candidatesFor(course: PlanCourse, placed: Assignment[], ctx: Ctx): Candidate[] {
  const taken = new Set(placed.filter((item) => item.courseId === course.id).map((item) => item.slotId));
  const roomOptions: Array<PlanRoom | null> = needsRoom(course) ? ctx.rooms : [null];
  const found: Candidate[] = [];

  for (const slotId of course.availability) {
    if (taken.has(slotId)) continue;
    for (const room of roomOptions) {
      if (blockersFor(course, slotId, room, placed, ctx).length > 0) continue;
      found.push({ slotId, room, score: scoreFor(course, slotId, room, placed, ctx) });
    }
  }

  const roomRank = new Map(ctx.rooms.map((room, index) => [room.id, index]));
  return found.sort((a, b) => {
    // The fallback pass may rehouse an earlier course. Keep READY a hard
    // priority for those moves too, ahead of every preference score.
    const tier = Number(a.room?.tier === "NEEDS_APPROVAL") - Number(b.room?.tier === "NEEDS_APPROVAL");
    if (tier) return tier;
    if (b.score !== a.score) return b.score - a.score;
    if (a.slotId !== b.slotId) return slotRank(a.slotId) - slotRank(b.slotId);
    return (roomRank.get(a.room?.id ?? "") ?? 0) - (roomRank.get(b.room?.id ?? "") ?? 0);
  });
}

function toAssignment(course: PlanCourse, candidate: Candidate, source: Assignment["source"], placed: Assignment[]): Assignment {
  return {
    id: nextAssignmentId(course.id, placed),
    courseId: course.id,
    slotId: candidate.slotId,
    roomId: candidate.room?.id ?? null,
    ...defaultTimesFor(candidate.slotId),
    locked: false,
    source,
  };
}

/**
 * Everything standing in the way of one specific placement.
 *
 * The same function the planner uses, exposed for the UI: the dialog that
 * offers courses for an empty period shows each one with its reasons rather
 * than hiding the ones that do not fit. A person who has just got off the phone
 * with a company may know something this data does not, so the rule is: show
 * the cost, allow the choice.
 */
export function placementBlockers(input: {
  course: PlanCourse;
  courses: PlanCourse[];
  rooms: PlanRoom[];
  placed: Assignment[];
  slotId: SlotId;
  roomId: string | null;
  options?: SchedulerOptions;
}): BlockerCode[] {
  const ctx = makeCtx(input.courses, input.rooms, input.options);
  const room = input.roomId ? (input.rooms.find((item) => item.id === input.roomId) ?? null) : null;
  return blockersFor(input.course, input.slotId, room, input.placed, ctx);
}

/**
 * Why a course could not be placed, period by period, with things to try.
 *
 * A planner that says "could not schedule" and stops has handed the problem
 * back without any of what it learned solving it. Every blocker below names
 * the course or room in the way, so the reader knows which phone call to make.
 */
export function explainFailure(input: {
  course: PlanCourse;
  courses: PlanCourse[];
  rooms: PlanRoom[];
  placed: Assignment[];
  options?: SchedulerOptions;
}): FailureReason {
  const { course, placed } = input;
  const ctx = makeCtx(input.courses, input.rooms, input.options);
  return explain(course, placed, ctx);
}

function explain(course: PlanCourse, placed: Assignment[], ctx: Ctx): FailureReason {
  const perSlot: SlotFailure[] = [];
  const suggestions: Suggestion[] = [];
  const seenSuggestion = new Set<string>();
  const push = (suggestion: Suggestion, key: string) => {
    if (seenSuggestion.has(key)) return;
    seenSuggestion.add(key);
    suggestions.push(suggestion);
  };

  const roomOptions: Array<PlanRoom | null> = needsRoom(course) ? ctx.rooms : [null];

  for (const slotId of course.availability) {
    const perRoom = roomOptions.map((room) => ({ room, blockers: blockersFor(course, slotId, room, placed, ctx) }));
    if (perRoom.some((entry) => entry.blockers.length === 0)) continue;

    /*
     * Report only what blocks EVERY option, not everything seen anywhere.
     *
     * The union lists "the room is too small" whenever any one room is too
     * small, which is nearly always true with nine rooms of different sizes —
     * so a course actually held up by a busy lecturer read as a room problem,
     * and the reader went looking for a bigger room. The intersection is the
     * set of reasons that survived every candidate. It can be empty when the
     * options failed for different reasons; the union is the fallback then.
     */
    const shared = perRoom
      .map((entry) => entry.blockers)
      .reduce((left, right) => left.filter((code) => right.includes(code)), perRoom[0]?.blockers ?? []);
    const blockers = shared.length > 0 ? shared : [...new Set(perRoom.flatMap((entry) => entry.blockers))];
    const details: string[] = [];

    const { startTime, endTime } = defaultTimesFor(slotId);
    const day = dayOf(slotId);
    const clashing = placed.filter(
      (item) => dayOf(item.slotId) === day && overlaps(startTime, endTime, item.startTime, item.endTime),
    );

    if (blockers.includes("ROOM_TOO_SMALL") && !blockers.includes("ROOM_DOUBLE_BOOKED")) {
      const largest = Math.max(0, ...ctx.rooms.map((room) => room.seats));
      details.push(`ต้องการ ${course.minSeats} ที่นั่ง ห้องที่ใหญ่ที่สุดในระบบมี ${largest}`);
      const reachable = ctx.rooms
        .filter((room) => room.seats < course.minSeats)
        .map((room) => room.seats)
        .sort((a, b) => b - a)[0];
      if (reachable) {
        push(
          { kind: "REDUCE_CAPACITY", courseId: course.id, seats: reachable, label: `ลดจำนวนที่รับเหลือ ${reachable} คน` },
          `reduce:${reachable}`,
        );
      }
    }

    for (const item of clashing) {
      const other = ctx.coursesById.get(item.courseId);
      if (!other) continue;
      const room = ctx.rooms.find((candidate) => candidate.id === item.roomId);
      if (item.roomId && room) details.push(`${room.name} ถูกใช้โดย ${other.title}`);
      if (other.instructor === course.instructor) details.push(`${other.instructor} สอน ${other.title} อยู่`);
      else if (other.provider === course.provider) details.push(`${other.provider} ส่งทีมไปสอน ${other.title} แล้ว`);
      // if (item.locked) {
      //   push(
      //     { kind: "UNLOCK_COURSE", courseId: other.id, label: `ปลดล็อก ${other.title} แล้วจัดใหม่` },
      //     `unlock:${other.id}`,
      //   );
      // }
    }

    for (const room of ctx.rooms) {
      const blocked = room.blockedSlots.find((entry) => entry.slotId === slotId);
      if (!blocked) continue;
      if (room.seats < course.minSeats) continue;
      details.push(`${room.name} ถูกกันไว้: ${blocked.reason}`);
      push(
        { kind: "FREE_ROOM_SLOT", roomId: room.id, slotId, label: `ปลดการกัน ${room.name} คาบนี้` },
        `free:${room.id}:${slotId}`,
      );
    }

    perSlot.push({
      slotId,
      blockers: blockers.length ? blockers : ["NO_ROOM_AVAILABLE"],
      detail: details.length ? [...new Set(details)].join(" · ") : "ไม่มีห้องที่ว่างและรองรับจำนวนที่รับได้",
    });
  }

  // The company's name is on the row already; repeating it inside the button
  // made every button a different width for no extra information.
  push({ kind: "ASK_MORE_AVAILABILITY", courseId: course.id, label: "ขอช่วงเวลาเพิ่ม" }, `ask:${course.id}`);

  return { perSlot, suggestions };
}

/**
 * Place one session, moving other courses out of the way if that is what it
 * takes.
 *
 * Only unlocked assignments may be moved, and only `depth` of them in a chain.
 * Without a bound this becomes a search that can walk the whole week for a
 * course that was never placeable; with one, a course that genuinely does not
 * fit fails quickly and says why.
 */
function placeWithBacktrack(course: PlanCourse, placed: Assignment[], ctx: Ctx, depth: number): Assignment[] | null {
  const direct = candidatesFor(course, placed, ctx);
  if (direct.length > 0) return [...placed, toAssignment(course, direct[0], "AUTO", placed)];
  if (depth <= 0) return null;

  const taken = new Set(placed.filter((item) => item.courseId === course.id).map((item) => item.slotId));

  for (const slotId of course.availability) {
    if (taken.has(slotId)) continue;
    const { startTime, endTime } = defaultTimesFor(slotId);
    const day = dayOf(slotId);

    const movable = placed.filter(
      (item) =>
        !item.locked &&
        item.courseId !== course.id &&
        dayOf(item.slotId) === day &&
        overlaps(startTime, endTime, item.startTime, item.endTime),
    );

    for (const blocker of movable) {
      const blockerCourse = ctx.coursesById.get(blocker.courseId);
      if (!blockerCourse) continue;

      const without = placed.filter((item) => item.id !== blocker.id);
      const forCourse = candidatesFor(course, without, ctx).filter((candidate) => candidate.slotId === slotId);
      if (forCourse.length === 0) continue;

      const withTarget = [...without, toAssignment(course, forCourse[0], "AUTO", without)];
      const rehoused = placeWithBacktrack(blockerCourse, withTarget, ctx, depth - 1);
      if (rehoused) return rehoused;
    }
  }

  return null;
}

/**
 * Fill the timetable from a set of offers.
 *
 * Courses are taken most-constrained-first: whichever has the fewest workable
 * placements left goes next. That is the whole answer to the original problem
 * — a company free only on Wednesday morning has one option and is placed
 * before a company free on Wednesday morning *and* Friday evening, so by the
 * time the second one is considered, Wednesday is gone and it takes Friday. No
 * rule anywhere names either company.
 */
export function autoAssign(input: {
  courses: PlanCourse[];
  rooms: PlanRoom[];
  locked?: Assignment[];
  options?: SchedulerOptions;
}): ScheduleResult {
  const options = { ...DEFAULTS, ...input.options };
  const ctx = makeCtx(input.courses, input.rooms, options);

  let placed: Assignment[] = [...new Map((input.locked ?? []).map((item) => [item.id, item])).values()];
  const unassigned: Unassigned[] = [];

  const remaining = new Map<string, number>();
  for (const course of input.courses) {
    const already = placed.filter((item) => item.courseId === course.id).length;
    remaining.set(course.id, Math.max(0, course.sessionsPerWeek - already));
  }

  const abandoned = new Set<string>();

  while (true) {
    const pending = input.courses.filter(
      (course) => (remaining.get(course.id) ?? 0) > 0 && !abandoned.has(course.id),
    );
    if (pending.length === 0) break;

    // Most-constrained-first, recomputed each round: what was flexible before
    // the last placement may not be after it.
    const ranked = pending
      .map((course) => ({ course, options: candidatesFor(course, placed, ctx).length }))
      .sort((a, b) => {
        if (a.options !== b.options) return a.options - b.options;
        const sessions = (remaining.get(b.course.id) ?? 0) - (remaining.get(a.course.id) ?? 0);
        if (sessions !== 0) return sessions;
        if (b.course.minSeats !== a.course.minSeats) return b.course.minSeats - a.course.minSeats;
        return a.course.courseCode.localeCompare(b.course.courseCode);
      });

    const { course } = ranked[0];
    const next = placeWithBacktrack(course, placed, ctx, options.backtrackDepth);

    if (!next) {
      const sessionIndex = course.sessionsPerWeek - (remaining.get(course.id) ?? 0) + 1;
      unassigned.push({ courseId: course.id, sessionIndex, reason: explain(course, placed, ctx) });
      abandoned.add(course.id);
      continue;
    }

    placed = next;
    // Backtracking may have re-placed other courses, so recount rather than
    // assuming this round placed exactly one session of exactly this course.
    for (const item of input.courses) {
      const done = placed.filter((entry) => entry.courseId === item.id).length;
      if (!abandoned.has(item.id)) remaining.set(item.id, Math.max(0, item.sessionsPerWeek - done));
    }
  }

  return { assignments: sortAssignments(placed), unassigned };
}

export function sortAssignments(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => {
    if (a.slotId !== b.slotId) return slotRank(a.slotId) - slotRank(b.slotId);
    return (a.roomId ?? "").localeCompare(b.roomId ?? "") || a.courseId.localeCompare(b.courseId);
  });
}

/**
 * The entry point the UI calls: place everything in จุฬาพัฒน์ if it can, and
 * only open the Faculty of Engineering rooms to whatever is left over.
 *
 * Two passes rather than a preference weight, so the guarantee is absolute: no
 * course prefers a READY room whenever a legal READY placement exists. The
 * fallback may rehouse unlocked first-pass assignments; user locks stay fixed.
 */
export function planSchedule(input: {
  courses: PlanCourse[];
  rooms: PlanRoom[];
  locked?: Assignment[];
  options?: SchedulerOptions;
}): ScheduleResult {
  const ready = input.rooms.filter((room) => room.tier === "READY");
  const first = autoAssign({ ...input, rooms: ready });
  if (first.unassigned.length === 0 || ready.length === input.rooms.length) return first;

  const stuck = new Set(first.unassigned.map((entry) => entry.courseId));
  // Keep all courses in the lookup, including the first pass's teachers.
  const second = autoAssign({
    courses: input.courses,
    rooms: input.rooms,
    locked: [...(input.locked ?? []), ...first.assignments.filter((item) => !stuck.has(item.courseId))],
    options: input.options,
  });

  // Backtracking can have moved an unlocked first-pass course. Returning its
  // old position here would resurrect conflicts the second pass just solved.
  return second;
}
