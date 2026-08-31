"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EmptyResult } from "@/components/empty-result";
import { PlanShell } from "@/components/plan-shell";
import { ResultAnnouncer } from "@/components/result-announcer";
import { formatNumber } from "@/lib/format";
import { ALL_SLOTS, DAY_SHORT, DAYS, PERIODS, parseSlotId, type SlotId } from "@/lib/slots.ts";
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
  const [minSeats, setMinSeats] = useState("");
  const [building, setBuilding] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);

  const buildings = useMemo(
    () => [...new Set(plan.rooms.map((room) => room.building))],
    [plan.rooms],
  );

  /**
   * "จ. ทั้งวัน · อ. เช้า, บ่าย" rather than the first four periods in order.
   *
   * Listed raw, a room with a free Monday spends the whole line on Monday and
   * ends "และอีก 14 คาบ" — which tells a reader looking for a Friday slot
   * nothing at all. Grouping by day fits the whole week in the same space.
   */
  const summariseFree = (free: SlotId[]) => {
    const byDay = DAYS.map((day) => ({
      day,
      periods: free.filter((slotId) => parseSlotId(slotId).day === day).map((slotId) => parseSlotId(slotId).period),
    })).filter((entry) => entry.periods.length > 0);
    if (byDay.length === 0) return "เต็มทุกคาบ";
    const shown = byDay.slice(0, 3).map((entry) =>
      entry.periods.length === 3
        ? `${DAY_SHORT[entry.day]} ทั้งวัน`
        : `${DAY_SHORT[entry.day]} ${entry.periods.map((period) => PERIODS[period].label).join(", ")}`,
    );
    const rest = byDay.length - shown.length;
    return `ว่าง: ${shown.join(" · ")}${rest > 0 ? ` และอีก ${rest} วัน` : ""}`;
  };

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
    if (building && room.building !== building) return false;
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
    setBuilding("");
    setOnlyFree(false);
  };
  const hasFilters = Boolean(minSeats || building || onlyFree);

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
            อาคาร
            <select value={building} onChange={(event) => setBuilding(event.target.value)}>
              <option value="">ทั้งหมด</option>
              {buildings.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
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
                      <span className="room-card-free">{summariseFree(usage.free)}</span>
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
