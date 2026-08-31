"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConflictPanel } from "@/components/conflict-panel";
import { PlanMatrix } from "@/components/plan-matrix";
import { PlanShell } from "@/components/plan-shell";
import { PriorityKpi } from "@/components/priority-kpi";
import { QueueFilterGroup } from "@/components/queue-filter";
import { StatusToast, useStatusToast } from "@/components/status-toast";
import { BLOCKER_LABELS } from "@/lib/blocker-labels.ts";
import { formatNumber } from "@/lib/format";
import type { QueueKind } from "@/lib/queue";
import { ALL_SLOTS, slotLabel } from "@/lib/slots.ts";
import type { PlanPayload, Suggestion } from "@/lib/plan-types.ts";
import { usePlanState } from "@/lib/use-plan-state";

export function PlanOverview({ payload }: { payload: PlanPayload }) {
  const plan = usePlanState(payload);
  const router = useRouter();
  const { toast, show, dismiss, holdTimer, resumeTimer } = useStatusToast();
  const [queue, setQueue] = useState<QueueKind | "all">("all");

  const roomsById = useMemo(() => new Map(plan.rooms.map((room) => [room.id, room])), [plan.rooms]);
  const coursesById = useMemo(() => new Map(plan.courses.map((course) => [course.id, course])), [plan.courses]);

  const totalSessions = plan.courses.reduce((sum, course) => sum + course.sessionsPerWeek, 0);
  const lockedCount = plan.assignments.filter((item) => item.locked).length;
  const needsApproval = plan.assignments.filter(
    (item) => item.roomId && roomsById.get(item.roomId)?.tier === "NEEDS_APPROVAL",
  ).length;

  const readyCapacity = plan.rooms
    .filter((room) => room.tier === "READY")
    .reduce((sum, room) => sum + (ALL_SLOTS.length - room.blockedSlots.length), 0);
  const roomSlotsUsed = plan.assignments.filter((item) => item.roomId).length;
  const utilisation = readyCapacity ? Math.round((roomSlotsUsed / readyCapacity) * 100) : 0;
  const placedPercent = totalSessions ? Math.round((plan.assignments.length / totalSessions) * 100) : 0;

  const applySuggestion = (suggestion: Suggestion) => {
    if (suggestion.kind === "UNLOCK_COURSE") {
      for (const item of plan.assignments) {
        if (item.courseId === suggestion.courseId && item.locked) plan.toggleLock(item.id);
      }
      show(`ปลดล็อก ${coursesById.get(suggestion.courseId)?.title ?? ""} แล้ว — กดจัดตารางอัตโนมัติอีกครั้ง`, plan.undo);
      return;
    }
    if (suggestion.kind === "REDUCE_CAPACITY") {
      plan.setCourseField(suggestion.courseId, { minSeats: suggestion.seats, capacity: suggestion.seats });
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

  const runPlan = () => {
    const result = plan.runAutoAssign();
    show(
      result.unassigned.length
        ? `จัดตารางแล้ว · ยังเหลือ ${formatNumber(result.unassigned.length)} วิชาที่ลงไม่ได้`
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
    >
      <div className="intro-row">
        <div>
          <p className="section-kicker">ภาคต้น ปีการศึกษา 2569</p>
          <h2>วางตารางสอนจากช่วงที่บริษัทสะดวก</h2>
          <p className="intro-copy">
            แต่ละบริษัทแจ้งช่วงที่สอนได้ไม่เท่ากัน ระบบจะล็อกวิชาที่มีทางเลือกน้อยที่สุดก่อน แล้วปัดวิชาที่ยืดหยุ่นกว่าไปช่วงอื่น
          </p>
        </div>
        <div className="intro-badges">
          <span className="scope-chip">
            <span className="scope-chip-label">คาบต่อสัปดาห์</span> {formatNumber(ALL_SLOTS.length)}
          </span>
          <span className="scope-chip">
            <span className="scope-chip-label">ห้องที่ใช้ได้ทันที</span>{" "}
            {formatNumber(plan.rooms.filter((room) => room.tier === "READY").length)} จาก {formatNumber(plan.rooms.length)}
          </span>
        </div>
      </div>

      <div className="kpi-grid">
        <PriorityKpi
          label="รายการที่ต้องดู"
          count={plan.conflicts.length}
          counts={plan.counts}
          note="ตรวจให้หมดก่อนสรุปแผนส่งบริษัท"
          pressed={queue !== "all"}
          onClick={() => setQueue(queue === "all" ? "BLOCKED" : "all")}
        />
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
          <p className="kpi-note">นับตามจำนวนคาบที่แต่ละวิชาต้องได้ต่อสัปดาห์</p>
        </div>
        <div className="kpi-card green">
          <span className="kpi-topline">
            <span className="kpi-label">ยืนยันแล้ว</span>
          </span>
          <p className="kpi-value">{formatNumber(lockedCount)}</p>
          <p className="kpi-note">คาบที่ล็อกไว้ การจัดอัตโนมัติจะไม่แตะ</p>
        </div>
        <div className="kpi-card purple">
          <span className="kpi-topline">
            <span className="kpi-label">การใช้ห้องจุฬาพัฒน์</span>
            <span className="kpi-context">{utilisation}%</span>
          </span>
          <p className="kpi-value compact">
            {formatNumber(roomSlotsUsed)} / {formatNumber(readyCapacity)}
          </p>
          <span className="kpi-progress">
            <span className="kpi-progress-fill purple" style={{ width: `${Math.min(utilisation, 100)}%` }} />
          </span>
          <p className="kpi-note">คาบ-ห้องที่ใช้ไป เทียบกับที่ภาคใช้ได้ทันที</p>
        </div>
        <div className="kpi-card orange">
          <span className="kpi-topline">
            <span className="kpi-label">ต้องขออนุมัติห้อง</span>
          </span>
          <p className="kpi-value">{formatNumber(needsApproval)}</p>
          <p className="kpi-note">คาบที่ตกไปอยู่ห้องตึก 3 / ตึก 4 ของคณะวิศวะ</p>
        </div>
      </div>

      <section className="panel follow-up-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">สิ่งที่ค้างอยู่</p>
            <h3>รายการที่ต้องแก้ก่อนสรุปแผน</h3>
          </div>
          <span className="count-chip">{formatNumber(plan.conflicts.length)} รายการ</span>
        </div>
        <QueueFilterGroup
          label="ความเร่งด่วน"
          value={queue}
          counts={plan.counts}
          total={plan.conflicts.length}
          onChange={setQueue}
        />
        <ConflictPanel conflicts={plan.conflicts} gaps={plan.gaps} filter={queue} onSuggestion={applySuggestion} />
      </section>

      <section className="panel matrix-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">ทั้งภาควิชา · จันทร์ถึงเสาร์</p>
            <h3>ตารางห้องเรียนทั้งสัปดาห์</h3>
          </div>
          <div className="table-heading-actions">
            <Link className="text-button" href="/courses/list">ดูรายวิชาทั้งหมด</Link>
            <button
              className="secondary-button"
              type="button"
              onClick={() => { plan.clearUnlocked(); show("ล้างคาบที่ยังไม่ล็อกแล้ว", plan.undo); }}
            >
              ล้างที่ยังไม่ล็อก
            </button>
            <button className="primary-button" type="button" onClick={runPlan}>
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
          onRemove={(id) => { plan.remove(id); show("เอาวิชาออกจากตารางแล้ว", plan.undo); }}
          onBlockedDrop={(title, slotId, blockers) =>
            show(`${title} ลง${slotLabel(slotId)}แล้ว แต่ ${blockers.map((code) => BLOCKER_LABELS[code]).join(" · ")}`, plan.undo)
          }
        />
      </section>

      <StatusToast toast={toast} onDismiss={dismiss} onHold={holdTimer} onResume={resumeTimer} />
    </PlanShell>
  );
}
