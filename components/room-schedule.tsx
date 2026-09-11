"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AssignDialog } from "@/components/assign-dialog";
import { BookingDialog, type BookingTarget } from "@/components/booking-dialog";
import { CourseChip } from "@/components/course-chip";
import { PlanShell } from "@/components/plan-shell";
import { ResultAnnouncer } from "@/components/result-announcer";
import { RoomDialog, type RoomFormTarget } from "@/components/room-dialog";
import { StatusToast, useStatusToast } from "@/components/status-toast";
import { WeekGrid } from "@/components/week-grid";
import { formatNumber } from "@/lib/format";
import { slotLabel, type SlotId } from "@/lib/slots.ts";
import type { PlanPayload } from "@/lib/plan-types.ts";
import { usePlanState } from "@/lib/use-plan-state";

/**
 * One room's week, and the only place a plan is edited by hand.
 *
 * Moving a class works two ways on purpose. Dragging is what a mouse user will
 * reach for; the "ย้าย" button turns every period into a target that can be
 * reached with Tab and Enter. Drag-and-drop alone would put the main action of
 * this page out of reach of the keyboard and off the phone entirely, in a
 * codebase that has otherwise gone to some trouble about both.
 */
export function RoomSchedule({ payload, roomId }: { payload: PlanPayload; roomId: string }) {
  const plan = usePlanState(payload);
  const router = useRouter();
  const { toast, show, dismiss, holdTimer, resumeTimer } = useStatusToast();
  const [assignSlot, setAssignSlot] = useState<SlotId | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [roomForm, setRoomForm] = useState<RoomFormTarget | null>(null);
  const [booking, setBooking] = useState<BookingTarget | null>(null);

  const room = plan.rooms.find((item) => item.id === roomId) ?? null;
  const coursesById = useMemo(() => new Map(plan.courses.map((course) => [course.id, course])), [plan.courses]);
  const moving = movingId ? plan.assignments.find((item) => item.id === movingId) ?? null : null;

  if (!room) {
    return (
      <PlanShell
        eyebrow="NextLink"
        title="ไม่พบห้องนี้"
        lastUpdated={payload.lastUpdated}
        timezone={payload.timezone}
        isMock={payload.isMock}
        editedAt={plan.editedAt}
        onReset={plan.resetAll}
      >
        <section className="panel">
          <p className="panel-caption">ไม่มีห้องรหัส {roomId} ในระบบ</p>
          <Link className="secondary-button" href="/rooms">กลับไปหน้ารายชื่อห้อง</Link>
        </section>
      </PlanShell>
    );
  }

  const inThisRoom = plan.assignments.filter((item) => item.roomId === room.id);

  const placeInSlot = (courseId: string, slotId: SlotId) => {
    const course = coursesById.get(courseId);
    if (!course) return;
    // An online course keeps its "no room" nature even when picked from a room's
    // grid — otherwise it would silently start consuming a room.
    plan.place(courseId, slotId, course.deliveryMode === "ONLINE" ? null : room.id);
    setAssignSlot(null);
    setAnnouncement(`เพิ่ม ${course.title} ลง ${slotLabel(slotId)} แล้ว`);
    show(`เพิ่ม ${course.title} ลง${slotLabel(slotId)}`, plan.undo);
  };

  const moveTo = (slotId: SlotId) => {
    if (!moving) return;
    const course = coursesById.get(moving.courseId);
    plan.move(moving.id, slotId, moving.roomId === null ? null : room.id);
    setMovingId(null);
    setAnnouncement(`ย้าย ${course?.title ?? ""} ไป ${slotLabel(slotId)} แล้ว`);
    show(`ย้าย ${course?.title ?? ""} ไป${slotLabel(slotId)}`, plan.undo);
  };

  const dropOn = (slotId: SlotId, assignmentId: string) => {
    const target = plan.assignments.find((item) => item.id === assignmentId);
    if (!target || target.locked) return;
    const course = coursesById.get(target.courseId);
    plan.move(assignmentId, slotId, target.roomId === null ? null : room.id);
    setAnnouncement(`ย้าย ${course?.title ?? ""} ไป ${slotLabel(slotId)} แล้ว`);
    show(`ย้าย ${course?.title ?? ""} ไป${slotLabel(slotId)}`, plan.undo);
  };

  const capacity = 18 - room.blockedSlots.length;

  return (
    <PlanShell
      eyebrow={room.building}
      title={room.name}
      lastUpdated={payload.lastUpdated}
      timezone={payload.timezone}
      isMock={payload.isMock}
      editedAt={plan.editedAt}
      onReset={plan.resetAll}
    >
      <div className="intro-row">
        <div>
          <p className="section-kicker">
            <Link className="text-button" href="/rooms">← ห้องเรียนทั้งหมด</Link>
          </p>
          <h2>ตารางสอนของ {room.name}</h2>
          <p className="intro-copy">
            {room.seatsIsEstimated ? "ประมาณ " : ""}
            {formatNumber(room.seats)} ที่นั่ง · ใช้ไปแล้ว {formatNumber(inThisRoom.length)} จาก {formatNumber(capacity)} คาบ
            {room.tier === "NEEDS_APPROVAL" ? " · ห้องนี้ต้องยื่นเรื่องขอใช้กับคณะวิศวะก่อน" : ""}
          </p>
        </div>
        <div className="intro-badges">
          <button className="secondary-button" type="button" onClick={() => setRoomForm({ room })}>
            แก้ไขห้องนี้
          </button>
          {room.seatsIsEstimated ? (
            <span className="scope-chip">
              <span className="scope-chip-label">ความจุ</span> ยังไม่ยืนยัน
            </span>
          ) : null}
          {room.tier === "NEEDS_APPROVAL" ? <span className="status-pill tone-orange">ต้องขออนุมัติ</span> : null}
        </div>
      </div>

      {moving ? (
        <p className="edit-mode-note">
          กำลังย้าย <strong>{coursesById.get(moving.courseId)?.title}</strong> — เลือกคาบปลายทาง หรือ
          <button className="text-button" type="button" onClick={() => setMovingId(null)}>ยกเลิก</button>
        </p>
      ) : null}

      <ResultAnnouncer message={announcement} />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">จันทร์ถึงเสาร์ · 3 คาบต่อวัน</p>
            <h3>ลากวิชาลงคาบว่าง หรือกดปุ่มเพิ่ม</h3>
          </div>
          <span className="panel-caption">ล็อกคาบที่ยืนยันแล้ว เพื่อกันการจัดอัตโนมัติทับ</span>
        </div>

        <WeekGrid
          label={`ตารางสอนของ ${room.name}`}
          renderCell={(slotId: SlotId) => {
            const blocked = room.blockedSlots.find((entry) => entry.slotId === slotId);
            const here = inThisRoom.filter((item) => item.slotId === slotId);

            if (blocked) {
              return (
                <div className="slot-cell is-blocked">
                  <span className="slot-blocked-label">กันไว้</span>
                  <small>{blocked.reason}</small>
                  {/* The hold is released from the period it holds — the same
                      place it was made, and the only place the reader is
                      looking when they wonder whether it still applies. */}
                  <button
                    className="slot-add"
                    type="button"
                    onClick={() => setBooking({ room, slotId, reason: blocked.reason })}
                  >
                    แก้ไขการกัน
                    <span className="sr-only"> {slotLabel(slotId)}</span>
                  </button>
                </div>
              );
            }

            const blockingFor = (assignmentId: string) =>
              plan.conflicts.filter(
                (conflict) => conflict.severity === "BLOCKED" && conflict.assignmentIds.includes(assignmentId),
              );
            const hasConflict = (assignmentId: string) => blockingFor(assignmentId).length > 0;
            // A red border says "something is wrong here" and nothing else. The
            // reader then has to hunt the follow-up list for which of the eight
            // rules it broke — so the cell says it in place.
            const cellProblems = [...new Set(here.flatMap((item) => blockingFor(item.id).map((c) => c.title)))];

            return (
              <div
                className={`slot-cell${here.length === 0 ? " is-empty" : ""}${here.some((item) => hasConflict(item.id)) ? " is-conflict" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData("text/plain");
                  if (id) dropOn(slotId, id);
                }}
              >
                {here.map((assignment) => {
                  const course = coursesById.get(assignment.courseId);
                  if (!course) return null;
                  return (
                    <CourseChip
                      key={assignment.id}
                      course={course}
                      assignment={assignment}
                      room={room}
                      showRoom={false}
                      showTime={false}
                      hasConflict={hasConflict(assignment.id)}
                      draggable
                      onToggleLock={() => plan.toggleLock(assignment.id)}
                      onMove={() => setMovingId(assignment.id)}
                      onRemove={() => {
                        plan.remove(assignment.id);
                        setAnnouncement(`เอา ${course.title} ออกจาก ${slotLabel(slotId)} แล้ว`);
                        show(`เอา ${course.title} ออกจากตาราง`, plan.undo);
                      }}
                    />
                  );
                })}

                {cellProblems.length > 0 ? (
                  <p className="slot-conflict-note">{cellProblems.join(" · ")}</p>
                ) : null}

                {moving ? (
                  <button className="slot-add is-move-target" type="button" onClick={() => moveTo(slotId)}>
                    ย้ายมาที่ {slotLabel(slotId)}
                  </button>
                ) : (
                  <span className="slot-actions">
                    <button className="slot-add" type="button" onClick={() => setAssignSlot(slotId)}>
                      <span aria-hidden="true">＋</span>
                      <span className="sr-only">เพิ่มวิชาลง {slotLabel(slotId)} ใน {room.name}</span>
                    </button>
                    {/* Only offered while the period is empty: a period with a
                        class in it is released by moving the class, not by
                        holding the period on top of it. */}
                    {here.length === 0 ? (
                      <button
                        className="slot-book"
                        type="button"
                        onClick={() => setBooking({ room, slotId, reason: null })}
                      >
                        กันคาบ
                        <span className="sr-only"> {slotLabel(slotId)} ไว้ให้วิชาอื่น</span>
                      </button>
                    ) : null}
                  </span>
                )}
              </div>
            );
          }}
        />
      </section>

      <AssignDialog
        slotId={assignSlot}
        room={room}
        courses={plan.courses}
        rooms={plan.rooms}
        assignments={plan.assignments}
        onPick={(courseId) => {
          if (assignSlot) placeInSlot(courseId, assignSlot);
        }}
        onClose={() => setAssignSlot(null)}
      />

      <RoomDialog
        target={roomForm}
        rooms={plan.rooms}
        assignedCount={plan.assignmentsInRoom(room.id)}
        onSave={(draft) => {
          plan.updateRoom(room.id, draft);
          show(`บันทึก ${draft.name} แล้ว`, plan.undo);
          setRoomForm(null);
        }}
        onDelete={() => {
          const losing = plan.assignmentsInRoom(room.id);
          plan.removeRoom(room.id);
          setRoomForm(null);
          // The page this is on has just stopped existing, so it leaves before
          // rendering "ไม่พบห้องนี้" at the person who removed it on purpose.
          router.push("/rooms");
          show(
            losing > 0
              ? `ลบ ${room.name} แล้ว · ${formatNumber(losing)} คาบกลับไปเป็นวิชาที่ยังไม่ได้จัด`
              : `ลบ ${room.name} แล้ว`,
            plan.undo,
          );
        }}
        onClose={() => setRoomForm(null)}
      />

      <BookingDialog
        target={booking}
        rooms={plan.rooms}
        onSave={(reason) => {
          if (!booking) return;
          plan.setBlocked(room.id, booking.slotId, reason);
          show(
            reason
              ? `กัน${slotLabel(booking.slotId)}ไว้ให้ ${reason}`
              : `ปลดการกัน${slotLabel(booking.slotId)}แล้ว`,
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
