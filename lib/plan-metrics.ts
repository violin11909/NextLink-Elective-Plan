import { ALL_SLOTS } from "./slots.ts";
import type { Assignment, PlanRoom } from "./plan-types.ts";
import type { Conflict } from "./conflicts.ts";

/** The numerator and denominator describe the same available READY room-slots. */
export function planMetrics(rooms: PlanRoom[], assignments: Assignment[], conflicts: Conflict[]) {
  const available = new Set(rooms.filter((room) => room.tier === "READY").flatMap((room) =>
    ALL_SLOTS.filter((slot) => !room.blockedSlots.some((entry) => entry.slotId === slot)).map((slot) => `${room.id}@${slot}`),
  ));
  const used = new Set(assignments.filter((item) => item.roomId && available.has(`${item.roomId}@${item.slotId}`))
    .map((item) => `${item.roomId}@${item.slotId}`));
  return {
    readyCapacity: available.size,
    roomSlotsUsed: used.size,
    utilisation: available.size ? Math.round(100 * used.size / available.size) : 0,
    flaggedCourses: new Set(conflicts.flatMap((conflict) => conflict.courseIds)).size,
  };
}
