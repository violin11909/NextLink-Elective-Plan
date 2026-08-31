"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EmptyResult } from "@/components/empty-result";
import { PlanShell } from "@/components/plan-shell";
import { ResultAnnouncer } from "@/components/result-announcer";
import { formatNumber } from "@/lib/format";
import { accentFor, buildRoomAccents } from "@/lib/room-colors.ts";
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
 */
export function RoomList({ payload }: { payload: PlanPayload }) {
  const plan = usePlanState(payload);
  const accents = useMemo(() => buildRoomAccents(plan.rooms), [plan.rooms]);
  const [minSeats, setMinSeats] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);

  /*
   * The card deliberately does not list which periods are free.
   *
   * It did, summarised by day, and it still read as a wall — "ว่าง: จ. ทั้งวัน ·
   * อ. เช้า, บ่าย · พ. ทั้งวัน และอีก 3 วัน" is eighteen facts compressed into
   * one line that has to be decoded rather than read. The room's own timetable
   * is one click away and shows the same thing as a picture, so the card keeps
   * the number that is actually scannable — how full the room is — and sends
   * the reader there for the detail.
   */
  const usageFor = (room: PlanRoom) => {
    const used = plan.assignments.filter((item) => item.roomId === room.id);
    const capacity = ALL_SLOTS.length - room.blockedSlots.length;
    const free = ALL_SLOTS.filter(
      (slotId) =>
        !room.blockedSlots.some((blocked) => blocked.slotId === slotId) &&
        !used.some((item) => item.slotId === slotId),
    );
    return { used: used.length, capacity, free };
  };

  const seatsFloor = Number(minSeats) || 0;
  const matching = plan.rooms.filter((room) => {
    if (seatsFloor && room.seats < seatsFloor) return false;
    if (onlyFree && usageFor(room).free.length === 0) return false;
    return true;
  });

  const groups: Array<{ tier: PlanRoom["tier"]; heading: string; caption: string }> = [
    { tier: "READY", heading: "ใช้ได้ทันที", caption: "ห้องของภาค จัดลงได้เลยโดยไม่ต้องขออนุมัติ" },
    {
      tier: "NEEDS_APPROVAL",
      heading: "ต้องขออนุมัติก่อนใช้",
      caption: "ห้องของคณะวิศวะ ต้องยื่นเรื่องหลายขั้นตอน ใช้เมื่อจุฬาพัฒน์ไม่พอ",
    },
  ];

  const clearFilters = () => {
    setMinSeats("");
    setOnlyFree(false);
  };
  const hasFilters = Boolean(minSeats || onlyFree);

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
          <span className="scope-chip">
            <span className="scope-chip-label">คาบต่อห้องต่อสัปดาห์</span> {formatNumber(ALL_SLOTS.length)}
          </span>
        </div>
      </div>

      <section className="control-panel">
        <div className="control-heading">
          <div>
            <p className="section-kicker">ตัวกรอง</p>
            <h3>หาห้องที่ต้องการ</h3>
          </div>
        </div>
        <div className="filters">
          <label>
            ความจุขั้นต่ำ
            <input
              type="number"
              min={0}
              value={minSeats}
              placeholder="เช่น 60"
              onChange={(event) => setMinSeats(event.target.value)}
            />
          </label>
          <label>
            เฉพาะห้องที่ยังมีคาบว่าง
            <select value={onlyFree ? "yes" : "no"} onChange={(event) => setOnlyFree(event.target.value === "yes")}>
              <option value="no">แสดงทุกห้อง</option>
              <option value="yes">เฉพาะที่ยังว่าง</option>
            </select>
          </label>
        </div>
      </section>

      <ResultAnnouncer message={`พบ ${matching.length} ห้อง`} />

      {matching.length === 0 ? (
        <section className="panel">
          <EmptyResult message="ไม่พบห้องที่ตรงกับตัวกรอง" hasFilters={hasFilters} onClear={clearFilters} />
        </section>
      ) : (
        groups.map((group) => {
          const rooms = matching.filter((room) => room.tier === group.tier);
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
                        <strong>
                          {/* The same swatch the board uses for this room, so a
                              colour seen there can be traced back to a name. */}
                          <span className="room-swatch" style={{ background: accentFor(accents, room.id) }} aria-hidden="true" />
                          {room.name}
                        </strong>
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
        })
      )}
    </PlanShell>
  );
}
