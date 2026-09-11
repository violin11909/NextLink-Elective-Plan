import { isSlotId, isTimeRange, PERIODS, parseSlotId, type SlotId } from "./slots.ts";
import type { Assignment, PlanCourse, PlanRoom } from "./plan-types.ts";

/** Stable identity within a plan; moving a session never changes this id. */
export function nextAssignmentId(courseId: string, assignments: Assignment[]): string {
  const used = new Set(assignments.map((item) => item.id));
  for (let index = 1; ; index += 1) {
    const id = `${courseId}:session:${index}`;
    if (!used.has(id)) return id;
  }
}

export function assertPlacement(
  course: PlanCourse | undefined, rooms: PlanRoom[], assignments: Assignment[],
  slotId: SlotId, roomId: string | null, ignoreId?: string,
): asserts course is PlanCourse {
  if (!course || !isSlotId(slotId)) throw new Error("ไม่พบวิชาหรือคาบเรียนนี้");
  if (course.deliveryMode !== "ONLINE" && (!roomId || !rooms.some((room) => room.id === roomId))) {
    throw new Error("วิชาในห้องเรียนหรือไฮบริดต้องมีห้องเรียน กรุณาเลือกคอลัมน์ห้อง");
  }
  if (course.deliveryMode === "ONLINE" && roomId !== null) throw new Error("วิชาออนไลน์ไม่ใช้ห้องเรียน");
  const others = assignments.filter((item) => item.courseId === course.id && item.id !== ignoreId);
  if (others.some((item) => item.slotId === slotId)) throw new Error("วิชานี้มีคาบในช่วงปลายทางแล้ว กรุณาเลือกคาบอื่น");
  if (others.length >= course.sessionsPerWeek) throw new Error("วิชานี้ถูกจัดครบจำนวนคาบแล้ว");
}

export function placeAssignment(input: {
  courses: PlanCourse[]; rooms: PlanRoom[]; assignments: Assignment[];
  courseId: string; slotId: SlotId; roomId: string | null;
}): Assignment[] {
  const course = input.courses.find((item) => item.id === input.courseId);
  assertPlacement(course, input.rooms, input.assignments, input.slotId, input.roomId);
  const bounds = PERIODS[parseSlotId(input.slotId).period];
  return [...input.assignments, {
    id: nextAssignmentId(course.id, input.assignments), courseId: course.id,
    slotId: input.slotId, roomId: input.roomId, startTime: bounds.start, endTime: bounds.end,
    locked: false, source: "MANUAL",
  }];
}

export function moveAssignment(input: {
  courses: PlanCourse[]; rooms: PlanRoom[]; assignments: Assignment[];
  assignmentId: string; slotId: SlotId; roomId: string | null;
}): Assignment[] {
  const current = input.assignments.find((item) => item.id === input.assignmentId);
  if (!current) throw new Error("ไม่พบคาบที่จะย้าย");
  if (current.locked) throw new Error("ปลดล็อกคาบนี้ก่อนย้าย");
  const course = input.courses.find((item) => item.id === current.courseId);
  assertPlacement(course, input.rooms, input.assignments, input.slotId, input.roomId, current.id);
  const bounds = PERIODS[parseSlotId(input.slotId).period];
  return input.assignments.map((item) => item.id !== current.id ? item : {
    ...item, slotId: input.slotId, roomId: input.roomId, source: "MANUAL",
    // A room-only move must not erase custom teaching times.
    startTime: item.slotId === input.slotId ? item.startTime : bounds.start,
    endTime: item.slotId === input.slotId ? item.endTime : bounds.end,
  });
}

export function changeAssignmentTime(assignments: Assignment[], id: string, startTime: string, endTime: string): Assignment[] {
  if (!isTimeRange(startTime, endTime)) throw new Error("เวลาเริ่มต้องอยู่ก่อนเวลาจบ และอยู่ในวันเดียวกัน");
  return assignments.map((item) => item.id === id ? { ...item, startTime, endTime } : item);
}
