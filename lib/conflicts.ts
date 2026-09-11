import { personName } from "./format.ts";
import { DAY_LABELS, PERIODS, isTimeRange, overlaps, parseSlotId, slotLabel } from "./slots.ts";
import { teachingBlockers, type SchedulerOptions } from "./schedule-policy.ts";
import type { Assignment, BlockerCode, PlanCourse, PlanRoom } from "./plan-types.ts";
import type { QueueKind } from "./queue.ts";

/**
 * What is wrong with the plan as it currently stands.
 *
 * Separate from the scheduler on purpose. The scheduler runs when someone
 * presses a button and is allowed to think; this runs on every drag, every
 * time edit and every availability change, and must be cheap enough to sit in
 * a `useMemo`.
 *
 * It also answers a different question. The scheduler asks "where can this
 * go?" and refuses to put a course anywhere illegal. This asks "what did we
 * end up with?" — including placements a person made deliberately against the
 * rules, which they are allowed to do. Somebody who has just got off the phone
 * with a company knows something this data does not, and a planner that
 * refuses the drop is a planner they stop using. So: always let it happen,
 * always say what it costs.
 */

export type ConflictCode =
  | BlockerCode
  | "SPILLS_PERIOD"
  | "UNDER_SCHEDULED"
  | "NO_AVAILABILITY"
  | "INVALID_TIME"
  | "OVER_SCHEDULED"
  | "NEEDS_ROOM_APPROVAL";

export type Conflict = {
  id: string;
  code: ConflictCode;
  /** Whose course this is — company and lecturer. The row reads as an errand to
   *  run, and the errand is always a phone call to one of these. */
  who: string[];
  /** Reuses the shared follow-up vocabulary so the KPI card and the filter
   *  chips work without a second set of names. */
  severity: QueueKind;
  courseIds: string[];
  assignmentIds: string[];
  title: string;
  detail: string;
};

const SEVERITY: Record<ConflictCode, QueueKind> = {
  ROOM_DOUBLE_BOOKED: "BLOCKED",
  INSTRUCTOR_BUSY: "BLOCKED",
  PROVIDER_BUSY: "BLOCKED",
  ROOM_BLOCKED: "BLOCKED",
  ROOM_TOO_SMALL: "BLOCKED",
  OUTSIDE_AVAILABILITY: "BLOCKED",
  NO_ROOM_AVAILABLE: "BLOCKED",
  UNDER_SCHEDULED: "WAITING",
  NO_AVAILABILITY: "WAITING",
  NEEDS_ROOM_APPROVAL: "WAITING",
  SPILLS_PERIOD: "IN_PROGRESS",
  INVALID_TIME: "BLOCKED",
  OVER_SCHEDULED: "BLOCKED",
};

/*
 * Deliberately not a conflict: two courses of the same category in one period.
 *
 * The scheduler still prefers to avoid it — see `avoidCategoryClash` in
 * SCHEDULER_WEIGHTS — but reporting it as something to fix was overreach. With
 * eighteen periods in a week and five courses in the AI category, the overlap
 * is close to unavoidable, and the system does not know how many electives a
 * student takes or which ones they were choosing between. It was telling the
 * coordinator off for a decision it had no standing to judge.
 */

/*
 * Deliberately not a conflict: "placed but not locked yet".
 *
 * It was one, briefly, and it put a row here for every class in the plan — so
 * a week that had come out perfectly reported thirteen things to look at. A
 * counter that reads thirteen when nothing is wrong is a counter people learn
 * to ignore, and then it is worth nothing on the day something is. How many
 * periods are confirmed is a number, not a problem; it belongs in the KPI row
 * beside the others, and on each chip as its own lock icon.
 */

export function detectConflicts(input: {
  courses: PlanCourse[];
  rooms: PlanRoom[];
  assignments: Assignment[];
  options?: SchedulerOptions;
}): Conflict[] {
  const coursesById = new Map(input.courses.map((course) => [course.id, course]));
  const roomsById = new Map(input.rooms.map((room) => [room.id, room]));
  const found: Conflict[] = [];

  const add = (
    code: ConflictCode,
    key: string,
    title: string,
    detail: string,
    courseIds: string[],
    assignmentIds: string[],
  ) => {
    found.push({
      id: `${code}:${key}`,
      code,
      severity: SEVERITY[code],
      courseIds,
      assignmentIds,
      who: [
        ...new Set(
          courseIds
            .map((id) => coursesById.get(id))
            .filter((course): course is PlanCourse => Boolean(course))
            .map((course) => `${course.provider} · ${personName(course.instructor)}`),
        ),
      ],
      title,
      detail,
    });
  };

  // --- Pairwise checks: two assignments whose real times touch on one day ---
  for (let i = 0; i < input.assignments.length; i += 1) {
    for (let j = i + 1; j < input.assignments.length; j += 1) {
      const a = input.assignments[i];
      const b = input.assignments[j];
      if (parseSlotId(a.slotId).day !== parseSlotId(b.slotId).day) continue;
      if (!overlaps(a.startTime, a.endTime, b.startTime, b.endTime)) continue;

      const courseA = coursesById.get(a.courseId);
      const courseB = coursesById.get(b.courseId);
      if (!courseA || !courseB) continue;
      const when = `${DAY_LABELS[parseSlotId(a.slotId).day]} ${a.startTime}–${a.endTime}`;
      const pair = [a.id, b.id].sort().join("+");

      if (a.roomId && a.roomId === b.roomId) {
        const room = roomsById.get(a.roomId);
        add(
          "ROOM_DOUBLE_BOOKED",
          pair,
          `${room?.name ?? a.roomId} ถูกจองซ้ำ`,
          `${courseA.title} และ ${courseB.title} ใช้ห้องเดียวกัน ${when}`,
          [courseA.id, courseB.id],
          [a.id, b.id],
        );
      }
      const teaching = teachingBlockers(courseA, courseB, input.options);
      if (teaching.includes("INSTRUCTOR_BUSY")) {
        add(
          "INSTRUCTOR_BUSY",
          pair,
          `${courseA.instructor} สอนสองที่พร้อมกัน`,
          `${courseA.title} และ ${courseB.title} ตรงกัน ${when}`,
          [courseA.id, courseB.id],
          [a.id, b.id],
        );
      } else if (teaching.includes("PROVIDER_BUSY")) {
        add("PROVIDER_BUSY", pair, `${courseA.provider} ต้องส่งสองทีมพร้อมกัน`,
          `${courseA.title} และ ${courseB.title} ตรงกัน ${when}`, [courseA.id, courseB.id], [a.id, b.id]);
      }
    }
  }

  // --- Per-assignment checks ---
  for (const assignment of input.assignments) {
    const course = coursesById.get(assignment.courseId);
    if (!course) continue;
    const { period } = parseSlotId(assignment.slotId);
    const room = assignment.roomId ? roomsById.get(assignment.roomId) : null;
    if (course.deliveryMode !== "ONLINE" && !room) {
      add("NO_ROOM_AVAILABLE", assignment.id, `${course.title} ยังไม่มีห้องเรียน`,
        "ต้องเลือกห้องเรียนที่ยังอยู่ในระบบสำหรับวิชาในห้องเรียนหรือไฮบริด", [course.id], [assignment.id]);
    }
    if (!isTimeRange(assignment.startTime, assignment.endTime)) {
      add("INVALID_TIME", assignment.id, `${course.title} มีเวลาสอนไม่ถูกต้อง`,
        "เวลาเริ่มต้องอยู่ก่อนเวลาจบและเป็นเวลาในวันเดียวกัน", [course.id], [assignment.id]);
    }

    if (!course.availability.includes(assignment.slotId)) {
      add(
        "OUTSIDE_AVAILABILITY",
        assignment.id,
        `${course.provider} ไม่สะดวก${slotLabel(assignment.slotId)}`,
        `ช่วงที่แจ้งไว้คือ ${course.availability.map(slotLabel).join(" · ") || "ยังไม่ได้แจ้ง"}`,
        [course.id],
        [assignment.id],
      );
    }

    if (room) {
      const blocked = room.blockedSlots.find((entry) => entry.slotId === assignment.slotId);
      if (blocked) {
        add(
          "ROOM_BLOCKED",
          assignment.id,
          `${room.name} ถูกกันไว้คาบนี้`,
          blocked.reason,
          [course.id],
          [assignment.id],
        );
      }
      if (room.seats < course.minSeats) {
        add(
          "ROOM_TOO_SMALL",
          assignment.id,
          `${room.name} เล็กเกินไป`,
          `${course.title} รับ ${course.minSeats} คน แต่ห้องมี ${room.seats} ที่นั่ง${room.seatsIsEstimated ? " (ตัวเลขยังไม่ยืนยัน)" : ""}`,
          [course.id],
          [assignment.id],
        );
      }
      if (room.tier === "NEEDS_APPROVAL") {
        add(
          "NEEDS_ROOM_APPROVAL",
          assignment.id,
          "ต้องยื่นเรื่องขอใช้ห้องกับคณะวิศวะ",
          `${course.title} ถูกจัดลง ${room.name} ซึ่งไม่ใช่ห้องของภาค`,
          [course.id],
          [assignment.id],
        );
      }
    }

    const bounds = PERIODS[period];
    if (assignment.startTime < bounds.start || assignment.endTime > bounds.end) {
      add(
        "SPILLS_PERIOD",
        assignment.id,
        `${course.title} ล้นออกนอกคาบ`,
        `คาบ${PERIODS[period].label}คือ ${bounds.start}–${bounds.end} แต่วิชานี้ ${assignment.startTime}–${assignment.endTime}`,
        [course.id],
        [assignment.id],
      );
    }

  }

  // --- Per-course checks ---
  for (const course of input.courses) {
    if (course.availability.length === 0) {
      add(
        "NO_AVAILABILITY",
        course.id,
        `${course.title} ยังไม่มีช่วงที่สะดวก`,
        `ต้องถาม ${course.provider} ว่าสอนคาบไหนได้บ้าง`,
        [course.id],
        [],
      );
      continue;
    }
    const placed = input.assignments.filter((item) => item.courseId === course.id);
    if (placed.length > course.sessionsPerWeek) {
      add("OVER_SCHEDULED", course.id, `${course.title} ถูกจัดเกินจำนวนคาบ`,
        `ต้องได้ ${course.sessionsPerWeek} คาบ แต่มี ${placed.length}`, [course.id], placed.map((item) => item.id));
    }
    if (placed.length < course.sessionsPerWeek) {
      add(
        "UNDER_SCHEDULED",
        course.id,
        `${course.title} ยังจัดไม่ครบ`,
        `ต้องได้ ${course.sessionsPerWeek} คาบต่อสัปดาห์ ตอนนี้ได้ ${placed.length}`,
        [course.id],
        placed.map((item) => item.id),
      );
    }
  }

  const order: QueueKind[] = ["BLOCKED", "WAITING", "IN_PROGRESS"];
  return found.sort((a, b) => {
    const bySeverity = order.indexOf(a.severity) - order.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const slotA = a.assignmentIds[0] ?? "";
    const slotB = b.assignmentIds[0] ?? "";
    return slotA.localeCompare(slotB) || a.id.localeCompare(b.id);
  });
}
