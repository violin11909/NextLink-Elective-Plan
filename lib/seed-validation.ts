import type { ArchivedSession, PlanCourse } from "./plan-types.ts";

export function assertSeedNumber(where: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${where}: expected integer ${min}..${max}`);
}

/** Archive facts have no edit UI: reject contradictions at ingestion/build time. */
export function validateArchiveSessions(courses: PlanCourse[], sessions: ArchivedSession[]) {
  const byId = new Map(courses.map((course) => [course.id, course]));
  const courseSlots = new Set<string>();
  const teacherSlots = new Set<string>();
  for (const session of sessions) {
    const course = byId.get(session.courseId);
    if (!course) throw new Error(`archive: unknown course ${session.courseId}`);
    const courseSlot = `${course.id}@${session.slotId}`;
    if (courseSlots.has(courseSlot)) throw new Error(`archive: duplicate course/slot ${courseSlot}`);
    courseSlots.add(courseSlot);
    const teacherSlot = `${course.instructor.trim()}@${session.slotId}`;
    if (teacherSlots.has(teacherSlot)) throw new Error(`archive: instructor collision ${teacherSlot}`);
    teacherSlots.add(teacherSlot);
    const hasRoom = typeof session.roomName === "string" && session.roomName.trim().length > 0;
    if (course.deliveryMode === "ONLINE" ? session.roomName !== null : !hasRoom) throw new Error(`archive: room inconsistent with delivery mode for ${course.id}`);
  }
}
