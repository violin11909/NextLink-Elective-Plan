"use client";

import { useMemo, useRef, useEffect } from "react";
import { formatNumber } from "@/lib/format";
import { placementBlockers } from "@/lib/scheduler.ts";
import { slotLabelWithTime, type SlotId } from "@/lib/slots.ts";
import type { Assignment, BlockerCode, PlanCourse, PlanRoom } from "@/lib/plan-types.ts";

const BLOCKER_LABELS: Record<BlockerCode, string> = {
  OUTSIDE_AVAILABILITY: "บริษัทไม่ได้แจ้งว่าสะดวกคาบนี้",
  ROOM_BLOCKED: "ห้องถูกกันไว้คาบนี้",
  ROOM_DOUBLE_BOOKED: "ห้องถูกใช้อยู่แล้ว",
  ROOM_TOO_SMALL: "ห้องเล็กกว่าจำนวนที่รับ",
  INSTRUCTOR_BUSY: "ผู้สอนติดสอนวิชาอื่น",
  PROVIDER_BUSY: "บริษัทส่งทีมไปสอนวิชาอื่นแล้ว",
  NO_ROOM_AVAILABLE: "ไม่มีห้องรองรับ",
};

/**
 * Pick a course for one empty period in one room.
 *
 * Two lists, not one filtered list. The courses a company actually offered for
 * this period come first; everything else is behind a heading that says so.
 * Sorting them into one ranked list would let an "outside availability" pick
 * look like an ordinary one, and that is the mistake that ends with a company
 * being told to teach on a day it already said it cannot.
 */
export function AssignDialog({
  slotId,
  room,
  courses,
  rooms,
  assignments,
  onPick,
  onClose,
}: {
  slotId: SlotId | null;
  room: PlanRoom | null;
  courses: PlanCourse[];
  rooms: PlanRoom[];
  assignments: Assignment[];
  onPick: (courseId: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (slotId) dialogRef.current?.showModal();
    else if (dialogRef.current?.open) dialogRef.current.close();
  }, [slotId]);

  const options = useMemo(() => {
    if (!slotId) return { offered: [], other: [] };
    const candidates = courses
      .filter((course) => {
        const placed = assignments.filter((item) => item.courseId === course.id);
        if (placed.length >= course.sessionsPerWeek) return false;
        return !placed.some((item) => item.slotId === slotId);
      })
      .map((course) => ({
        course,
        blockers: placementBlockers({
          course,
          courses,
          rooms,
          placed: assignments,
          slotId,
          roomId: course.deliveryMode === "ONLINE" ? null : (room?.id ?? null),
        }),
      }));
    return {
      offered: candidates.filter((item) => !item.blockers.includes("OUTSIDE_AVAILABILITY")),
      other: candidates.filter((item) => item.blockers.includes("OUTSIDE_AVAILABILITY")),
    };
  }, [slotId, room, courses, rooms, assignments]);

  /**
   * `offered` says which list this row is in, and it changes what the pill can
   * say. In the second list a green "ลงได้" would be a lie of omission: the
   * room and the timetable allow it, but the company said it cannot teach then,
   * and that is the fact the reader is one click away from overriding.
   */
  const renderRow = (offered: boolean) => ({ course, blockers }: { course: PlanCourse; blockers: BlockerCode[] }) => {
    const hard = blockers.filter((code) => code !== "OUTSIDE_AVAILABILITY");
    return (
      <li key={course.id}>
        <button className="assign-option" type="button" onClick={() => onPick(course.id)}>
          <span className="assign-option-copy">
            <strong>{course.title}</strong>
            <small>
              {course.provider} · {course.instructor} · รับ {formatNumber(course.capacity)} คน
            </small>
          </span>
          <span className="assign-option-warnings">
            {hard.map((code) => (
              <span className="status-pill status-pill-subtle tone-red" key={code}>
                {BLOCKER_LABELS[code]}
              </span>
            ))}
            {offered ? (
              hard.length === 0 ? <span className="status-pill status-pill-subtle tone-green">ลงได้</span> : null
            ) : (
              <span className="status-pill status-pill-subtle tone-orange">นอกช่วงที่บริษัทแจ้ง</span>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <dialog className="course-dialog assign-dialog" ref={dialogRef} onCancel={onClose} onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="dialog-header">
        <div>
          <p className="section-kicker">{room ? room.name : "เลือกคาบ"}</p>
          <h2>{slotId ? slotLabelWithTime(slotId) : ""}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="ปิดหน้าต่าง">×</button>
      </div>
      <div className="dialog-content">
        <div className="detail-section">
          <h3>บริษัทแจ้งว่าสะดวกคาบนี้</h3>
          {options.offered.length === 0 ? (
            <p className="panel-caption">ไม่มีวิชาที่บริษัทแจ้งว่าสะดวกคาบนี้และยังจัดไม่ครบ</p>
          ) : (
            <ul className="assign-option-list">{options.offered.map(renderRow(true))}</ul>
          )}
        </div>
        <details className="assign-other">
          <summary>วิชาที่บริษัทไม่ได้แจ้งว่าสะดวก ({formatNumber(options.other.length)})</summary>
          <p className="edit-mode-note">
            เลือกได้ถ้าคุณเพิ่งได้รับการยืนยันเพิ่มจากบริษัท ระบบจะขึ้นเตือนไว้จนกว่าจะแก้ช่วงที่สะดวกในหน้าวิชา
          </p>
          {options.other.length === 0 ? (
            <p className="panel-caption">ไม่มีวิชาอื่นที่ยังจัดไม่ครบ</p>
          ) : (
            <ul className="assign-option-list">{options.other.map(renderRow(false))}</ul>
          )}
        </details>
      </div>
    </dialog>
  );
}
