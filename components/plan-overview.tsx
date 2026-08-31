"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { ConflictPanel } from "@/components/conflict-panel";
import { EmptyResult } from "@/components/empty-result";
import { FilterSummary } from "@/components/filter-summary";
import { Pager } from "@/components/pager";
import { PlanMatrix } from "@/components/plan-matrix";
import { PlanShell } from "@/components/plan-shell";
import { PriorityKpi } from "@/components/priority-kpi";
import { QueueFilterGroup } from "@/components/queue-filter";
import { ResultAnnouncer } from "@/components/result-announcer";
import { SlotFilters, matchesSlotFilter } from "@/components/slot-filters";
import { StatusToast, useStatusToast } from "@/components/status-toast";
import { BLOCKER_LABELS } from "@/lib/blocker-labels.ts";
import { formatNumber } from "@/lib/format";
import type { QueueKind } from "@/lib/queue";
import { accentFor, buildRoomAccents } from "@/lib/room-colors.ts";
import { ALL_SLOTS, DAY_LABELS, PERIODS, slotLabel, type DayKey, type PeriodKey } from "@/lib/slots.ts";
import type { PlanPayload, Suggestion } from "@/lib/plan-types.ts";
import { usePlanState } from "@/lib/use-plan-state";
import { useUrlFilters } from "@/lib/use-url-filters";

type PlacementFilter = "all" | "placed" | "unplaced";

/** Short enough that the board above stays on screen while the list is read. */
const COURSE_PAGE_SIZE = 10;

export function PlanOverview({ payload }: { payload: PlanPayload }) {
  const plan = usePlanState(payload);
  const { toast, show, dismiss, holdTimer, resumeTimer } = useStatusToast();

  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [category, setCategory] = useState("");
  const [day, setDay] = useState<DayKey | "">("");
  const [period, setPeriod] = useState<PeriodKey | "">("");
  const [placement, setPlacement] = useState<PlacementFilter>("all");
  const [queue, setQueue] = useState<QueueKind | "all">("all");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);
  const deferredProvider = useDeferredValue(provider);

  useUrlFilters(
    { q: search, provider, category, day, period, placement: placement === "all" ? "" : placement },
    (found) => {
      if (found.q) setSearch(found.q);
      if (found.provider) setProvider(found.provider);
      if (found.category) setCategory(found.category);
      if (found.day) setDay(found.day as DayKey);
      if (found.period) setPeriod(found.period as PeriodKey);
      if (found.placement === "placed" || found.placement === "unplaced") setPlacement(found.placement);
    },
  );

  const accents = useMemo(() => buildRoomAccents(plan.rooms), [plan.rooms]);
  const roomsById = useMemo(() => new Map(plan.rooms.map((room) => [room.id, room])), [plan.rooms]);
  const coursesById = useMemo(() => new Map(plan.courses.map((course) => [course.id, course])), [plan.courses]);

  const providers = useMemo(
    () => [...new Set(plan.courses.map((course) => course.provider))].sort((a, b) => a.localeCompare(b, "th")),
    [plan.courses],
  );
  const categories = useMemo(
    () => [...new Set(plan.courses.map((course) => course.category))].sort((a, b) => a.localeCompare(b, "th")),
    [plan.courses],
  );

  const rows = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    const providerNeedle = deferredProvider.trim().toLowerCase();
    return plan.courses
      .map((course) => ({ course, placed: plan.assignments.filter((item) => item.courseId === course.id) }))
      .filter(({ course, placed }) => {
        if (providerNeedle && !course.provider.toLowerCase().includes(providerNeedle)) return false;
        if (category && course.category !== category) return false;
        if (!matchesSlotFilter(course.availability, day, period)) return false;
        if (placement === "placed" && placed.length < course.sessionsPerWeek) return false;
        if (placement === "unplaced" && placed.length >= course.sessionsPerWeek) return false;
        if (!needle) return true;
        return [course.title, course.courseCode, course.provider, course.instructor, course.category]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [plan.courses, plan.assignments, deferredSearch, deferredProvider, category, day, period, placement]);

  const pageCount = Math.max(1, Math.ceil(rows.length / COURSE_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = rows.slice((safePage - 1) * COURSE_PAGE_SIZE, safePage * COURSE_PAGE_SIZE);

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
    show("ต้องแก้ที่หน้าวิชาและช่วงที่สะดวก หรือปลดการกันห้องในหน้าห้องเรียน");
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

  const activeFilters = [
    search ? { label: "ค้นหา", value: search, onClear: () => setSearch("") } : null,
    provider ? { label: "บริษัท", value: provider, onClear: () => setProvider("") } : null,
    category ? { label: "หมวด", value: category, onClear: () => setCategory("") } : null,
    day || period
      ? {
          label: "ช่วงที่สะดวก",
          value: [day ? DAY_LABELS[day] : "", period ? PERIODS[period].label : ""].filter(Boolean).join(" "),
          onClear: () => { setDay(""); setPeriod(""); },
        }
      : null,
    placement !== "all"
      ? {
          label: "สถานะ",
          value: placement === "placed" ? "จัดแล้ว" : "ยังไม่ได้จัด",
          onClear: () => setPlacement("all"),
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const clearFilters = () => {
    setSearch("");
    setProvider("");
    setCategory("");
    setDay("");
    setPeriod("");
    setPlacement("all");
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

      <section className="panel table-panel">
        <div className="panel-heading table-heading">
          <div>
            <p className="section-kicker">รายวิชา</p>
            <h3>ช่วงที่บริษัทสะดวก และคาบที่ได้จริง</h3>
          </div>
          <Link className="text-button" href="/courses">แก้ช่วงที่สะดวก</Link>
        </div>

        <div className="filters">
          <label>
            ค้นหาวิชา หรือผู้สอน
            <input
              type="search"
              value={search}
              placeholder="เช่น Cloud, อาจารย์ธนา"
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </label>
          <label>
            บริษัท
            {/* A list, not a dropdown: a real term has hundreds of companies, and
                a select with hundreds of options is a scroll, not a choice. */}
            <input
              type="search"
              list="overview-providers"
              value={provider}
              placeholder="พิมพ์ชื่อบริษัท"
              onChange={(event) => { setProvider(event.target.value); setPage(1); }}
            />
            <datalist id="overview-providers">
              {providers.map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>
          <label>
            หมวด
            <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
              <option value="">ทั้งหมด</option>
              {categories.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>
            สถานะการจัด
            <select
              value={placement}
              onChange={(event) => { setPlacement(event.target.value as PlacementFilter); setPage(1); }}
            >
              <option value="all">ทั้งหมด</option>
              <option value="placed">จัดครบแล้ว</option>
              <option value="unplaced">ยังจัดไม่ครบ</option>
            </select>
          </label>
          <SlotFilters
            day={day}
            period={period}
            onDay={(next) => { setDay(next); setPage(1); }}
            onPeriod={(next) => { setPeriod(next); setPage(1); }}
          />
        </div>
        <FilterSummary summary={`พบ ${formatNumber(rows.length)} วิชา`} filters={activeFilters} />

        <ResultAnnouncer message={`พบ ${rows.length} วิชา`} />
        {rows.length === 0 ? (
          <EmptyResult message="ไม่พบวิชาที่ตรงกับตัวกรอง" hasFilters={activeFilters.length > 0} onClear={clearFilters} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">วิชา</th>
                    <th scope="col">บริษัท</th>
                    <th scope="col">ผู้สอน</th>
                    <th scope="col">ช่วงที่สะดวก</th>
                    <th scope="col">คาบที่ได้</th>
                    <th scope="col">ห้อง</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ course, placed }) => (
                    <tr key={course.id}>
                      <td>
                        {/* Both the title and the company lead to the same page,
                            filtered to what was clicked — from a row here the
                            next question is always "what else can they do", and
                            the answer lives on the availability page. */}
                        <Link className="course-link" href={`/courses?q=${encodeURIComponent(course.title)}`}>
                          <strong>{course.title}</strong>
                          <span className="course-code">{course.courseCode} · {course.category}</span>
                        </Link>
                      </td>
                      <td>
                        {/* Straight to this company's courses with the filter
                            already applied — the next thing anyone does after
                            spotting a company here is look at its other slots. */}
                        <Link className="provider-link" href={`/courses?provider=${encodeURIComponent(course.provider)}`}>
                          {course.provider}
                        </Link>
                      </td>
                      <td><span className="schedule-text">{course.instructor}</span></td>
                      <td>
                        <span className="schedule-text">
                          {course.availability.map(slotLabel).join(" · ") || "ยังไม่ได้แจ้ง"}
                        </span>
                      </td>
                      <td>
                        {placed.length === 0 ? (
                          <span className="status-pill tone-orange">ยังไม่ได้จัด</span>
                        ) : (
                          <span className="status-stack">
                            {placed.map((item) => (
                              <span className={`status-pill ${item.locked ? "tone-green" : "tone-blue"}`} key={item.id}>
                                {slotLabel(item.slotId)}{item.locked ? " · ยืนยันแล้ว" : ""}
                              </span>
                            ))}
                          </span>
                        )}
                        {placed.length < course.sessionsPerWeek ? (
                          <small>ต้องได้ {course.sessionsPerWeek} คาบ/สัปดาห์</small>
                        ) : null}
                      </td>
                      <td>
                        {course.deliveryMode === "ONLINE" ? (
                          <span className="room-tag" style={{ ["--room-accent" as string]: accentFor(accents, null) }}>
                            ออนไลน์
                          </span>
                        ) : placed.length === 0 ? (
                          <span className="schedule-text">—</span>
                        ) : (
                          <span className="status-stack">
                            {placed.map((item) => (
                              <span
                                className="room-tag"
                                key={item.id}
                                style={{ ["--room-accent" as string]: accentFor(accents, item.roomId) }}
                              >
                                {item.roomId ? roomsById.get(item.roomId)?.name ?? item.roomId : "ออนไลน์"}
                              </span>
                            ))}
                          </span>
                        )}
                        <small>รับ {formatNumber(course.capacity)} คน</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={safePage}
              pageCount={pageCount}
              total={rows.length}
              unit="วิชา"
              pageSize={COURSE_PAGE_SIZE}
              onChange={setPage}
            />
          </>
        )}
      </section>

      <StatusToast toast={toast} onDismiss={dismiss} onHold={holdTimer} onResume={resumeTimer} />
    </PlanShell>
  );
}
