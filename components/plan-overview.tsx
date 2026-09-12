"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookingDialog, type BookingTarget } from "@/components/booking-dialog";
import { ConflictPanel } from "@/components/conflict-panel";
import { PlanMatrix } from "@/components/plan-matrix";
import { RoomDialog, type RoomFormTarget } from "@/components/room-dialog";
import { PlanShell } from "@/components/plan-shell";
import { Pager } from "@/components/pager";
import { StatusToast, useStatusToast } from "@/components/status-toast";
import { BLOCKER_LABELS } from "@/lib/blocker-labels.ts";
import { formatNumber } from "@/lib/format";
import { planMetrics } from "@/lib/plan-metrics.ts";
import { slotLabel } from "@/lib/slots.ts";
import type { PlanCourse, PlanPayload, Suggestion } from "@/lib/plan-types.ts";
import { usePlanState } from "@/lib/use-plan-state";

/** Short enough that the board is still on screen under the list. */
const FOLLOW_UP_PAGE_SIZE = 5;

export function PlanOverview({ payload }: { payload: PlanPayload }) {
  const plan = usePlanState(payload);
  const router = useRouter();
  const { toast, show, dismiss, holdTimer, resumeTimer } = useStatusToast();
  const [followUpOpen, setFollowUpOpen] = useState(true);
  const [followUpPage, setFollowUpPage] = useState(1);
  const [holding, setHolding] = useState<PlanCourse | null>(null);
  /** The room form and the booking form, both opened from the board below. */
  const [roomForm, setRoomForm] = useState<RoomFormTarget | null>(null);
  const [booking, setBooking] = useState<BookingTarget | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  /** Where the board sat when a replan started, so it can be put back. */
  const anchorRef = useRef<number | null>(null);

  const onHeldChange = useCallback((course: PlanCourse | null) => setHolding(course), []);

  /**
   * Say refusals where the work is happening.
   *
   * A rule the plan enforces — "วิชานี้มีคาบในช่วงปลายทางแล้ว" — is reported by
   * the store into the save bar at the top of the page, which is nowhere near
   * the board someone is dragging cards around in. Without this the card
   * simply refuses to move and nothing on screen says why.
   */
  useEffect(() => {
    if (plan.error) show(plan.error);
  }, [plan.error, show]);


  const roomsById = useMemo(() => new Map(plan.rooms.map((room) => [room.id, room])), [plan.rooms]);
  const coursesById = useMemo(() => new Map(plan.courses.map((course) => [course.id, course])), [plan.courses]);

  const totalSessions = plan.courses.reduce((sum, course) => sum + course.sessionsPerWeek, 0);
  /** Companies that have not answered yet — nothing can be planned for these. */
  const awaitingAvailability = plan.courses.filter((course) => course.availability.length === 0).length;
  const needsApproval = plan.assignments.filter(
    (item) => item.roomId && roomsById.get(item.roomId)?.tier === "NEEDS_APPROVAL",
  ).length;

  const { readyCapacity, roomSlotsUsed, utilisation, flaggedCourses } = planMetrics(plan.rooms, plan.assignments, plan.conflicts);
  const placedPercent = totalSessions ? Math.round((plan.assignments.length / totalSessions) * 100) : 0;

  const followUpPageCount = Math.max(1, Math.ceil(plan.conflicts.length / FOLLOW_UP_PAGE_SIZE));
  const safeFollowUpPage = Math.min(followUpPage, followUpPageCount);
  const visibleConflicts = plan.conflicts.slice(
    (safeFollowUpPage - 1) * FOLLOW_UP_PAGE_SIZE,
    safeFollowUpPage * FOLLOW_UP_PAGE_SIZE,
  );

  const applySuggestion = async (suggestion: Suggestion) => {
    if (suggestion.kind === "UNLOCK_COURSE") {
      if (!await plan.unlockCourse(suggestion.courseId)) return;
      show(`ปลดล็อก ${coursesById.get(suggestion.courseId)?.title ?? ""} แล้ว — กดจัดตารางอัตโนมัติอีกครั้ง`, plan.undo);
      return;
    }
    if (suggestion.kind === "REDUCE_CAPACITY") {
      if (!await plan.setCourseField(suggestion.courseId, { minSeats: suggestion.seats, capacity: suggestion.seats })) return;
      show(`ปรับจำนวนที่รับเป็น ${suggestion.seats} คนแล้ว`, plan.undo);
      return;
    }
    if (suggestion.kind === "ASK_MORE_AVAILABILITY") {
      // The suggestion is an action, not a note: getting more periods out of a
      // company means editing that company's course, so the button goes there
      // with the course and the company already filled in.
      const course = coursesById.get(suggestion.courseId);
      const params = new URLSearchParams();
      if (course) {
        params.set("q", course.title);
        params.set("provider", course.provider);
      }
      router.push(`/courses?${params.toString()}`);
      return;
    }
    show("ต้องปลดการกันห้องในหน้าห้องเรียนก่อน");
  };

  /*
   * Keep the board where it is across a replan.
   *
   * Planning changes how many rows the follow-up list above has, which slides
   * the board up or down under the reader's cursor — and the board is what they
   * were looking at. Restoring the offset in a layout effect rather than a
   * requestAnimationFrame matters: the frame callback can run before React has
   * committed the new rows, and then the correction is computed against the old
   * layout and does nothing.
   */
  useLayoutEffect(() => {
    if (anchorRef.current === null) return;
    const target = anchorRef.current;
    anchorRef.current = null;
    const now = boardRef.current?.getBoundingClientRect().top ?? target;
    if (Math.abs(now - target) > 1) window.scrollBy(0, now - target);
  }, [plan.assignments, plan.conflicts]);

  const runPlan = async () => {
    anchorRef.current = boardRef.current?.getBoundingClientRect().top ?? null;
    const result = await plan.runAutoAssign();
    if (!result) return;
    show(
      result.unassigned.length
        ? `ยังหาแผนให้ ${formatNumber(new Set(result.unassigned.map((item) => item.courseId)).size)} วิชาไม่พบภายในขอบเขตค้นหา`
        : `จัดตารางครบทั้ง ${formatNumber(result.assignments.length)} คาบแล้ว`,
      plan.undo,
    );
  };

  return (
    <PlanShell
      eyebrow="NextLink"
      title="แผนตารางสอนวิชาเลือก"
      lastUpdated={payload.lastUpdated}
      timezone={payload.timezone}
      isMock={payload.isMock}
      editedAt={plan.editedAt}
      onReset={plan.resetAll}
      planTools
    >
      <div className="intro-row">
        <div>
          <p className="section-kicker">{payload.term.label}</p>
          <h2>วางตารางสอนจากช่วงที่บริษัทสะดวก</h2>
          <p className="intro-copy">
            {/* แต่ละบริษัทแจ้งช่วงที่สอนได้ไม่เท่ากัน ระบบจะล็อกวิชาที่มีทางเลือกน้อยที่สุดก่อน แล้วปัดวิชาที่ยืดหยุ่นกว่าไปช่วงอื่น */}
          </p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card red">
          <span className="kpi-topline">
            <span className="kpi-label">ยังไม่ระบุเวลาสอน</span>
            {awaitingAvailability > 0 ? <span className="kpi-alert-icon" aria-hidden="true">!</span> : null}
          </span>
          <p className="kpi-value">{formatNumber(awaitingAvailability)}</p>
          {/* <p className="kpi-note">วิชาที่บริษัทยังไม่แจ้งว่าสอนคาบไหนได้ — จัดให้ไม่ได้จนกว่าจะได้คำตอบ</p> */}
        </div>
        <div className="kpi-card blue">
          <span className="kpi-topline">
            <span className="kpi-label">คาบที่จัดแล้ว</span>
            <span className="kpi-context">{placedPercent}%</span>
          </span>
          <p className="kpi-value">
            {formatNumber(plan.assignments.length)} / {formatNumber(totalSessions)}
          </p>
          <span className="kpi-progress">
            <span className="kpi-progress-fill" style={{ width: `${Math.min(placedPercent, 100)}%` }} />
          </span>
          {/* <p className="kpi-note">นับตามจำนวนคาบที่แต่ละวิชาต้องได้ต่อสัปดาห์</p> */}
        </div>
        <div className="kpi-card green">
          <span className="kpi-topline">
            <span className="kpi-label">วิชาที่ยังมีปัญหา</span>
          </span>
          <p className="kpi-value">{formatNumber(flaggedCourses)}</p>
          <p className="kpi-note">นับวิชาไม่ซ้ำ รวมวิชาที่ยังจัดไม่ครบ</p>
        </div>
        <div className="kpi-card purple">
          <span className="kpi-topline">
            <span className="kpi-label">การใช้ห้องที่พร้อมใช้</span>
            <span className="kpi-context">{utilisation}%</span>
          </span>
          <p className="kpi-value compact">
            {formatNumber(roomSlotsUsed)} / {formatNumber(readyCapacity)}
          </p>
          <span className="kpi-progress">
            <span className="kpi-progress-fill purple" style={{ width: `${Math.min(utilisation, 100)}%` }} />
          </span>
          <p className="kpi-note">คาบ-ห้องที่ใช้ / คาบที่ว่างให้ใช้ได้ ไม่รวมห้องรออนุมัติ</p>
        </div>
        <div className="kpi-card orange">
          <span className="kpi-topline">
            <span className="kpi-label">ต้องขออนุมัติห้อง</span>
          </span>
          <p className="kpi-value">{formatNumber(needsApproval)}</p>
          {/* <p className="kpi-note">คาบที่ตกไปอยู่ห้องตึก 3 / ตึก 4 ของคณะวิศวะฯ</p> */}
        </div>
      </div>

      <section className="panel follow-up-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">สิ่งที่ค้างอยู่</p>
            <h3>รายการที่ต้องแก้ก่อนสรุปแผน</h3>
          </div>
          <div className="table-heading-actions">
            <span className="count-chip">{formatNumber(plan.conflicts.length)} รายการ</span>
            <button
              className="secondary-button"
              type="button"
              aria-expanded={followUpOpen}
              onClick={() => setFollowUpOpen((open) => !open)}
            >
              {followUpOpen ? "ซ่อนรายการ" : "แสดงรายการ"}
            </button>
          </div>
        </div>
        {followUpOpen ? (
          <>
            <ConflictPanel conflicts={visibleConflicts} gaps={plan.gaps} onSuggestion={applySuggestion} />
            <Pager
              page={safeFollowUpPage}
              pageCount={followUpPageCount}
              total={plan.conflicts.length}
              unit="รายการ"
              pageSize={FOLLOW_UP_PAGE_SIZE}
              onChange={setFollowUpPage}
            />
          </>
        ) : null}
      </section>

      <section className="panel matrix-panel" ref={boardRef}>
        <div className="panel-heading">
          <div>
            <p className="section-kicker">ทั้งภาควิชา · จันทร์ถึงเสาร์</p>
            <h3>ตารางห้องเรียนทั้งสัปดาห์</h3>
            {/* {holding ? (
              <p className="matrix-holding">
                กำลังวาง <strong>{holding.title}</strong> — ชี้ช่องที่ต้องการแล้วกด ช่องที่ขึ้นขอบเขียวคือวางได้
              </p>
            ) : null} */}
          </div>
          <div className="table-heading-actions">
            <Link className="text-button" href="/courses/list">ดูรายวิชาทั้งหมด</Link>
            <button className="secondary-button" type="button" onClick={() => setRoomForm({ room: null })}>
              ＋ เพิ่มห้อง
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={async () => { if (!await plan.clearUnlocked()) return; show("ล้างคาบที่ยังไม่ล็อกแล้ว", plan.undo); }}
            >
              ล้างที่ยังไม่ล็อก
            </button>
            <button className="primary-button" type="button" disabled={plan.status === "saving"} onClick={runPlan}>
              จัดตารางอัตโนมัติ
            </button>
          </div>
        </div>
        <PlanMatrix
          rooms={plan.rooms}
          courses={plan.courses}
          assignments={plan.assignments}
          conflicts={plan.conflicts}
          unplaced={plan.gaps.map((gap) => ({ course: gap.course, missing: gap.missing }))}
          onPlace={plan.place}
          onMove={plan.move}
          onToggleLock={plan.toggleLock}
          onRemove={async (id) => { if (!await plan.remove(id)) return; show("เอาวิชาออกจากตารางแล้ว", plan.undo); }}
          onBlockedDrop={(title, slotId, blockers, roomIgnored) =>
            show(
              // An online class has no room to give, so the room it was dropped on
              // is simply dropped. Say that, rather than reading out whatever else
              // is wrong with the period — the room is why the card moved back.
              roomIgnored
                ? `${title} เรียนออนไลน์ จัดห้องเรียนให้ไม่ได้ ${
                    blockers.length > 0 ? ` และ ${blockers.map((code) => BLOCKER_LABELS[code]).join(" · ")}` : ""
                  }`
                : `${title} ${blockers.map((code) => BLOCKER_LABELS[code]).join(" · ")}`,
                // ลง${slotLabel(slotId)}แล้ว แต่
              plan.undo,
            )
          }
          onHeldChange={onHeldChange}
          onEditRoom={(room) => setRoomForm({ room })}
          onBookSlot={(room, slotId, reason) => setBooking({ room, slotId, reason })}
        />
      </section>

      <RoomDialog
        target={roomForm}
        rooms={plan.rooms}
        assignedCount={roomForm?.room ? plan.assignmentsInRoom(roomForm.room.id) : 0}
        onSave={async (draft) => {
          if (roomForm?.room) {
            if (!await plan.updateRoom(roomForm.room.id, draft)) return;
            show(`บันทึก ${draft.name} แล้ว`, plan.undo);
          } else {
            if (!await plan.addRoom(draft)) return;
            show(`เพิ่ม ${draft.name} เข้าตารางแล้ว`, plan.undo);
          }
          setRoomForm(null);
        }}
        onDelete={async () => {
          const room = roomForm?.room;
          if (!room) return;
          const losing = plan.assignmentsInRoom(room.id);
          if (!await plan.removeRoom(room.id)) return;
          show(
            losing > 0
              ? `ลบ ${room.name} แล้ว · ${formatNumber(losing)} คาบกลับไปเป็นวิชาที่ยังไม่ได้จัด`
              : `ลบ ${room.name} แล้ว`,
            plan.undo,
          );
          setRoomForm(null);
        }}
        onClose={() => setRoomForm(null)}
      />

      <BookingDialog
        target={booking}
        rooms={plan.rooms}
        onSave={async (reason) => {
          if (!booking) return;
          if (!await plan.setBlocked(booking.room.id, booking.slotId, reason)) return;
          show(
            reason
              ? `กัน ${booking.room.name} ${slotLabel(booking.slotId)} ไว้ให้ ${reason}`
              : `ปลดการกัน ${booking.room.name} ${slotLabel(booking.slotId)} แล้ว`,
            plan.undo,
          );
          setBooking(null);
        }}
        onClose={() => setBooking(null)}
      />

      <StatusToast toast={toast} onDismiss={dismiss} onHold={holdTimer} onResume={resumeTimer} />
    </PlanShell>
  );
}
