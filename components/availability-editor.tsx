"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { EmptyResult } from "@/components/empty-result";
import { PlanShell } from "@/components/plan-shell";
import { ResultAnnouncer } from "@/components/result-announcer";
import { StatusToast, useStatusToast } from "@/components/status-toast";
import { formatNumber } from "@/lib/format";
import { SlotFilters, matchesSlotFilter } from "@/components/slot-filters";
import { DAYS, DAY_SHORT, PERIODS, PERIOD_KEYS, makeSlotId, slotLabel, type DayKey, type PeriodKey, type SlotId } from "@/lib/slots.ts";
import type { PlanPayload } from "@/lib/plan-types.ts";
import { usePlanState } from "@/lib/use-plan-state";
import { useUrlFilters } from "@/lib/use-url-filters";

/**
 * Where the companies' answers are kept up to date.
 *
 * This is the page that decides whether the planner survives contact with the
 * job. Availability changes every time somebody gets off the phone, and if
 * that edit has to go through a developer or back into a spreadsheet, the
 * spreadsheet becomes the real plan again within a week.
 */
export function AvailabilityEditor({ payload }: { payload: PlanPayload }) {
  const plan = usePlanState(payload);
  const { toast, show, dismiss, holdTimer, resumeTimer } = useStatusToast();
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [day, setDay] = useState<DayKey | "">("");
  const [period, setPeriod] = useState<PeriodKey | "">("");
  const deferredSearch = useDeferredValue(search);
  const deferredProvider = useDeferredValue(provider);

  // Arriving from a company name on the overview lands here with that company
  // already filled in, which is the only reason that link is worth clicking.
  useUrlFilters({ q: search, provider, day, period }, (found) => {
    if (found.q) setSearch(found.q);
    if (found.provider) setProvider(found.provider);
    if (found.day) setDay(found.day as DayKey);
    if (found.period) setPeriod(found.period as PeriodKey);
  });

  const rows = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    const providerNeedle = deferredProvider.trim().toLowerCase();
    return plan.courses.filter((course) => {
      if (providerNeedle && !course.provider.toLowerCase().includes(providerNeedle)) return false;
      if (!matchesSlotFilter(course.availability, day, period)) return false;
      if (!needle) return true;
      return [course.title, course.courseCode, course.provider, course.instructor]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [plan.courses, deferredSearch, deferredProvider, day, period]);

  const toggleSlot = (courseId: string, slotId: SlotId) => {
    const course = plan.courses.find((item) => item.id === courseId);
    if (!course) return;
    const next = course.availability.includes(slotId)
      ? course.availability.filter((item) => item !== slotId)
      : [...course.availability, slotId];
    plan.setAvailability(courseId, next);
    show(
      `${course.title}: ${course.availability.includes(slotId) ? "เอา" : "เพิ่ม"}${slotLabel(slotId)}`,
      plan.undo,
    );
  };

  return (
    <PlanShell
      eyebrow="NextLink"
      title="วิชาและช่วงที่สะดวก"
      lastUpdated={payload.lastUpdated}
      timezone={payload.timezone}
      isMock={payload.isMock}
      editedAt={plan.editedAt}
      onReset={plan.resetAll}
    >
      <div className="intro-row">
        <div>
          <p className="section-kicker">ข้อมูลจากบริษัท</p>
          <h2>ช่วงที่แต่ละบริษัทสอนได้</h2>
          <p className="intro-copy">
            ติ๊กคาบที่บริษัทแจ้งว่าสะดวก ยิ่งบริษัทให้ทางเลือกน้อย ระบบจะยิ่งจัดให้ก่อน
          </p>
        </div>
        <div className="intro-badges">
          <span className="scope-chip">
            <span className="scope-chip-label">วิชาทั้งหมด</span> {formatNumber(plan.courses.length)}
          </span>
        </div>
      </div>

      <section className="control-panel">
        <div className="control-heading">
          <div>
            <p className="section-kicker">ตัวกรอง</p>
            <h3>หาวิชาที่ต้องการแก้</h3>
          </div>
        </div>
        <div className="filters">
          <label>
            ค้นหา
            <input
              type="search"
              value={search}
              placeholder="ชื่อวิชา รหัส หรือบริษัท"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            บริษัท
            {/* Typed, and only typed: a real term brings hundreds of companies,
                and neither a select nor an autocomplete list of that length is
                faster than knowing the first three letters. */}
            <input
              type="search"
              value={provider}
              placeholder="พิมพ์ชื่อบริษัท"
              onChange={(event) => setProvider(event.target.value)}
            />
          </label>
          <SlotFilters day={day} period={period} onDay={setDay} onPeriod={setPeriod} />
        </div>
      </section>

      <p className="availability-legend">
        <span className="availability-slot is-on" aria-hidden="true">✓</span>
        <span>บริษัทแจ้งว่าสอนคาบนี้ได้</span>
        <span className="availability-slot is-used" aria-hidden="true">●</span>
        <span>สะดวก และตอนนี้วิชานี้ถูกจัดลงคาบนี้แล้ว</span>
        <span className="availability-slot" aria-hidden="true" />
        <span>ไม่สะดวก</span>
      </p>

      <ResultAnnouncer message={`พบ ${rows.length} วิชา`} />

      {rows.length === 0 ? (
        <section className="panel">
          <EmptyResult message="ไม่พบวิชาที่ตรงกับตัวกรอง" hasFilters={Boolean(search || provider || day || period)} />
        </section>
      ) : (
        <div className="course-availability-list">
          {rows.map((course) => {
            const placed = plan.assignments.filter((item) => item.courseId === course.id);
            const tooFew = course.availability.length < course.sessionsPerWeek;
            return (
              <section className="panel course-availability-card" key={course.id}>
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">{course.courseCode} · {course.category}</p>
                    <h3>{course.title}</h3>
                    <p className="panel-caption">
                      {course.provider} · {course.instructor} · รับ {formatNumber(course.capacity)} คน ·
                      ต้องได้ {formatNumber(course.sessionsPerWeek)} คาบ/สัปดาห์
                    </p>
                  </div>
                  <div className="readiness-heading-meta">
                    {placed.length === 0 ? (
                      <span className="status-pill tone-orange">ยังไม่ได้จัด</span>
                    ) : (
                      <span className="selection-chip-list">
                        {placed.map((item) => (
                          <span className="selection-chip" key={item.id}>{slotLabel(item.slotId)}</span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>

                <div className="availability-grid" role="group" aria-label={`ช่วงที่สะดวกของ ${course.title}`}>
                  <div className="availability-row">
                    <span className="availability-corner" aria-hidden="true" />
                    {DAYS.map((day) => (
                      <span className="availability-head" key={day}>{DAY_SHORT[day]}</span>
                    ))}
                  </div>
                  {PERIOD_KEYS.map((period) => (
                    <div className="availability-row" key={period}>
                      <span className="availability-period">
                        {PERIODS[period].label}
                        <small>{PERIODS[period].start}–{PERIODS[period].end}</small>
                      </span>
                      {DAYS.map((day) => {
                        const slotId = makeSlotId(day, period);
                        const on = course.availability.includes(slotId);
                        const used = placed.some((item) => item.slotId === slotId);
                        return (
                          <button
                            className={`availability-slot${on ? " is-on" : ""}${used ? " is-used" : ""}`}
                            key={slotId}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleSlot(course.id, slotId)}
                          >
                            <span aria-hidden="true">{used ? "●" : on ? "✓" : ""}</span>
                            <span className="sr-only">
                              {slotLabel(slotId)}
                              {used ? " — จัดวิชานี้ไว้แล้ว" : on ? " — สะดวก" : " — ไม่สะดวก"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {tooFew ? (
                  <p className="edit-mode-note">
                    วิชานี้ต้องได้ {formatNumber(course.sessionsPerWeek)} คาบต่อสัปดาห์ แต่บริษัทแจ้งไว้เพียง{" "}
                    {formatNumber(course.availability.length)} คาบ — ต้องขอเพิ่มก่อนจึงจะจัดครบได้
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <StatusToast toast={toast} onDismiss={dismiss} onHold={holdTimer} onResume={resumeTimer} />
    </PlanShell>
  );
}
