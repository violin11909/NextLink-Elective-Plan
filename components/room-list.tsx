"use client";

import { useState } from "react";
import Link from "next/link";
import { PlanShell } from "@/components/plan-shell";
import { RoomDialog, type RoomFormTarget } from "@/components/room-dialog";
import { StatusToast, useStatusToast } from "@/components/status-toast";
import { formatNumber } from "@/lib/format";
import { ALL_SLOTS } from "@/lib/slots.ts";
import type { PlanPayload, PlanRoom } from "@/lib/plan-types.ts";
import { usePlanState } from "@/lib/use-plan-state";

/**
 * Which rooms exist, and how much of the week each still has free.
 *
 * The two tiers are shown as two lists rather than a sortable column, because
 * they are not two values of one property — a จุฬาพัฒน์ room is available and
 * an Engineering-building room is a request someone has to file. Ranking them
 * in one list invites picking the wrong one by accident.
 *
 * This is also where the room list itself is edited. The department gains and
 * loses rooms between terms, and a list that can only be read goes stale the
 * first time that happens — with no way back except a code change.
 */
export function RoomList({ payload }: { payload: PlanPayload }) {
  const plan = usePlanState(payload);
  const { toast, show, dismiss, holdTimer, resumeTimer } = useStatusToast();
  const [roomForm, setRoomForm] = useState<RoomFormTarget | null>(null);

  const usageFor = (room: PlanRoom) => ({
    used: plan.assignments.filter((item) => item.roomId === room.id).length,
    capacity: ALL_SLOTS.length - room.blockedSlots.length,
  });

  const groups: Array<{ tier: PlanRoom["tier"]; heading: string; caption: string }> = [
    { tier: "READY", heading: "ใช้ได้ทันที", caption: "ห้องของภาค จัดลงได้เลยโดยไม่ต้องขออนุมัติ" },
    {
      tier: "NEEDS_APPROVAL",
      heading: "ต้องขออนุมัติก่อนใช้",
      caption: "ห้องของคณะวิศวะ ต้องยื่นเรื่องหลายขั้นตอน ใช้เมื่อจุฬาพัฒน์ไม่พอ",
    },
  ];

  return (
    <PlanShell
      eyebrow="NextLink"
      title="ห้องเรียนที่ใช้ได้"
      lastUpdated={payload.lastUpdated}
      timezone={payload.timezone}
      isMock={payload.isMock}
      editedAt={plan.editedAt}
      onReset={plan.resetAll}
    >
      <div className="intro-row">
        <div>
          <p className="section-kicker">เลือกห้องเพื่อเปิดตารางสอน</p>
          <h2>ห้องเรียน {formatNumber(plan.rooms.length)} ห้อง</h2>
          <p className="intro-copy">กดที่ห้องเพื่อดูตารางของห้องนั้น และลากวิชาลงคาบว่างได้</p>
        </div>
        <div className="intro-badges">
          <button className="primary-button" type="button" onClick={() => setRoomForm({ room: null })}>
            ＋ เพิ่มห้องเรียน
          </button>
        </div>
      </div>

      {groups.map((group) => {
        const rooms = plan.rooms.filter((room) => room.tier === group.tier);
        return (
          <section className="panel" key={group.tier}>
            <div className="panel-heading">
              <div>
                <p className="section-kicker">
                  {group.tier === "READY" ? "จุฬาพัฒน์" : "อาคารคณะวิศวกรรมศาสตร์"}
                </p>
                <h3>{group.heading}</h3>
              </div>
              <span className="panel-caption">{group.caption}</span>
            </div>
            {/* An empty group still prints its heading. With the list editable,
                "there are no rooms of this kind" is a state a person can create,
                and they have to be able to see that they created it. */}
            {rooms.length === 0 ? (
              <p className="panel-caption">ยังไม่มีห้องในหมวดนี้</p>
            ) : (
              <div className="room-grid">
                {rooms.map((room) => {
                  const usage = usageFor(room);
                  const percent = usage.capacity ? Math.round((usage.used / usage.capacity) * 100) : 0;
                  return (
                    /* The card stays one link to the room's timetable — that is
                       what a card is for. Editing is its own button beside it,
                       because a button inside a link is a coin toss about which
                       of the two a click lands on. */
                    <div className="room-card-shell" key={room.id}>
                      <Link className="room-card" href={`/rooms/${room.id}`}>
                        <span className="room-card-head">
                          <strong>{room.name}</strong>
                          {room.tier === "NEEDS_APPROVAL" ? (
                            <span className="status-pill tone-orange">ต้องขออนุมัติ</span>
                          ) : null}
                        </span>
                        <span className="room-card-meta">
                          {room.building} · ชั้น {room.floor} ·{" "}
                          {room.seatsIsEstimated ? `~${formatNumber(room.seats)}` : formatNumber(room.seats)} ที่นั่ง
                          {room.seatsIsEstimated ? (
                            <span className="note-icon" title="ตัวเลขนี้ยังไม่ได้ยืนยันกับผู้ดูแลอาคาร" aria-label="ความจุยังไม่ยืนยัน">?</span>
                          ) : null}
                        </span>
                        <span className="room-card-usage">
                          ใช้ไปแล้ว {formatNumber(usage.used)} / {formatNumber(usage.capacity)} คาบ
                          {room.blockedSlots.length > 0
                            ? ` · กันไว้ ${formatNumber(room.blockedSlots.length)} คาบ`
                            : ""}
                        </span>
                        <span className="mini-progress" aria-hidden="true">
                          <i style={{ width: `${Math.min(percent, 100)}%` }} />
                        </span>
                      </Link>
                      <button className="room-card-edit" type="button" onClick={() => setRoomForm({ room })}>
                        แก้ไข
                        <span className="sr-only"> {room.name}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <RoomDialog
        target={roomForm}
        rooms={plan.rooms}
        assignedCount={roomForm?.room ? plan.assignmentsInRoom(roomForm.room.id) : 0}
        onSave={(draft) => {
          if (roomForm?.room) {
            plan.updateRoom(roomForm.room.id, draft);
            show(`บันทึก ${draft.name} แล้ว`, plan.undo);
          } else {
            plan.addRoom(draft);
            show(`เพิ่ม ${draft.name} แล้ว`, plan.undo);
          }
          setRoomForm(null);
        }}
        onDelete={() => {
          const room = roomForm?.room;
          if (!room) return;
          const losing = plan.assignmentsInRoom(room.id);
          plan.removeRoom(room.id);
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

      <StatusToast toast={toast} onDismiss={dismiss} onHold={holdTimer} onResume={resumeTimer} />
    </PlanShell>
  );
}
