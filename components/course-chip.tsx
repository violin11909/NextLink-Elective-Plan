"use client";

import type { Assignment, PlanCourse, PlanRoom } from "@/lib/plan-types.ts";

/**
 * One placed class, as it appears inside a period.
 *
 * The lock button sits on the chip rather than behind a dialog because locking
 * is what a coordinator does the moment a company confirms — it is the most
 * frequent action on this page, and it has to be reachable in one press from
 * the thing it applies to.
 */
export function CourseChip({
  course,
  assignment,
  room,
  hasConflict,
  onOpen,
  onToggleLock,
  onMove,
  onRemove,
  draggable = false,
  showRoom = true,
  showTime = true,
}: {
  course: PlanCourse;
  assignment: Assignment;
  room: PlanRoom | null;
  hasConflict: boolean;
  onOpen?: () => void;
  onToggleLock?: () => void;
  onMove?: () => void;
  onRemove?: () => void;
  draggable?: boolean;
  /** False inside a single room's own grid, where naming the room on every
   *  chip only costs the course title the space it needs. */
  showRoom?: boolean;
  /** Same idea for the clock: a grid row already says which period this is. */
  showTime?: boolean;
}) {
  return (
    <div
      className={`course-chip${assignment.locked ? " is-locked" : ""}${hasConflict ? " is-conflict" : ""}`}
      draggable={draggable && !assignment.locked}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", assignment.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button className="chip-body" type="button" onClick={onOpen}>
        <strong>{course.title}</strong>
        <small>
          {course.provider}
          {showTime ? ` · ${assignment.startTime}–${assignment.endTime}` : ""}
          {showRoom ? (room ? ` · ${room.name}` : " · ออนไลน์") : ""}
        </small>
      </button>
      <span className="chip-actions">
        {onToggleLock ? (
          <button
            className={`chip-action${assignment.locked ? " is-on" : ""}`}
            type="button"
            aria-pressed={assignment.locked}
            title={assignment.locked ? "ปลดล็อกคาบนี้" : "ล็อกคาบนี้ไม่ให้ระบบย้าย"}
            onClick={onToggleLock}
          >
            <span aria-hidden="true">{assignment.locked ? "🔒" : "🔓"}</span>
            <span className="sr-only">{assignment.locked ? `ปลดล็อก ${course.title}` : `ล็อก ${course.title}`}</span>
          </button>
        ) : null}
        {onMove ? (
          <button className="chip-action" type="button" title="ย้ายไปคาบอื่น" onClick={onMove}>
            <span aria-hidden="true">↔</span>
            <span className="sr-only">ย้าย {course.title} ไปคาบอื่น</span>
          </button>
        ) : null}
        {onRemove ? (
          <button className="chip-action" type="button" title="เอาออกจากตาราง" onClick={onRemove}>
            <span aria-hidden="true">×</span>
            <span className="sr-only">เอา {course.title} ออกจากตาราง</span>
          </button>
        ) : null}
      </span>
    </div>
  );
}
