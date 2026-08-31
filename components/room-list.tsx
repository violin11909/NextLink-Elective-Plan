"use client";

import Link from "next/link";
import { PlanShell } from "@/components/plan-shell";
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
 * There are no filters. Nine rooms fit on one screen, and a filter bar over a
 * list you can already see whole is a control that only costs a look.
 */
export function RoomList({ payload }: { payload: PlanPayload }) {
  const plan = usePlanState(payload);

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
      </div>

      {groups.map((group) => {
        const rooms = plan.rooms.filter((room) => room.tier === group.tier);
        if (rooms.length === 0) return null;
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
            <div className="room-grid">
              {rooms.map((room) => {
                const usage = usageFor(room);
                const percent = usage.capacity ? Math.round((usage.used / usage.capacity) * 100) : 0;
                return (
                  <Link className="room-card" href={`/rooms/${room.id}`} key={room.id}>
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
                    </span>
                    <span className="mini-progress" aria-hidden="true">
                      <i style={{ width: `${Math.min(percent, 100)}%` }} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </PlanShell>
  );
}
