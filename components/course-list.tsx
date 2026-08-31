"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyResult } from "@/components/empty-result";
import { FilterSummary } from "@/components/filter-summary";
import { Pager } from "@/components/pager";
import { PlanShell } from "@/components/plan-shell";
import { ResultAnnouncer } from "@/components/result-announcer";
import { SlotFilters, matchesSlotFilter } from "@/components/slot-filters";
import { formatNumber } from "@/lib/format";
import { accentFor, buildRoomAccents } from "@/lib/room-colors.ts";
import { DAY_LABELS, PERIODS, slotLabel, type DayKey, type PeriodKey } from "@/lib/slots.ts";
import type { PlanPayload } from "@/lib/plan-types.ts";
import { usePlanState } from "@/lib/use-plan-state";
import { useUrlFilters } from "@/lib/use-url-filters";

type PlacementFilter = "all" | "placed" | "unplaced";

const PAGE_SIZE = 15;

/**
 * Every course as a row: what the company offered, and what it got.
 *
 * It used to sit under the board on the overview, which meant the board — the
 * thing you are actually working in — shared the page with a table you only
 * consult. On its own page the board gets the whole screen and this gets room
 * to be a proper reference list.
 */
export function CourseList({ payload }: { payload: PlanPayload }) {
  const plan = usePlanState(payload);

  const [search, setSearch] = useState("");
  const [day, setDay] = useState<DayKey | "">("");
  const [period, setPeriod] = useState<PeriodKey | "">("");
  const [placement, setPlacement] = useState<PlacementFilter>("all");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  useUrlFilters({ q: search, day, period, placement: placement === "all" ? "" : placement }, (found) => {
    if (found.q) setSearch(found.q);
    if (found.day) setDay(found.day as DayKey);
    if (found.period) setPeriod(found.period as PeriodKey);
    if (found.placement === "placed" || found.placement === "unplaced") setPlacement(found.placement);
  });

  const accents = useMemo(() => buildRoomAccents(plan.rooms), [plan.rooms]);
  const roomsById = useMemo(() => new Map(plan.rooms.map((room) => [room.id, room])), [plan.rooms]);

  const rows = useMemo(() => {
    // One box for course, lecturer, company and category. Four separate
    // controls asked the reader to know which field a word lived in before
    // they could look it up, which is a question the box can answer itself.
    const needle = deferredSearch.trim().toLowerCase();
    return plan.courses
      .map((course) => ({ course, placed: plan.assignments.filter((item) => item.courseId === course.id) }))
      .filter(({ course, placed }) => {
        if (!matchesSlotFilter(course.availability, day, period)) return false;
        if (placement === "placed" && placed.length < course.sessionsPerWeek) return false;
        if (placement === "unplaced" && placed.length >= course.sessionsPerWeek) return false;
        if (!needle) return true;
        return [course.title, course.courseCode, course.provider, course.instructor, course.category]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [plan.courses, plan.assignments, deferredSearch, day, period, placement]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const activeFilters = [
    search ? { label: "ค้นหา", value: search, onClear: () => setSearch("") } : null,
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
    setDay("");
    setPeriod("");
    setPlacement("all");
  };

  return (
    <PlanShell
      eyebrow="NextLink"
      title="รายวิชาเลือก"
      lastUpdated={payload.lastUpdated}
      timezone={payload.timezone}
      isMock={payload.isMock}
      editedAt={plan.editedAt}
      onReset={plan.resetAll}
    >
      <div className="intro-row">
        <div>
          <p className="section-kicker">รายวิชา</p>
          <h2>ช่วงที่บริษัทสะดวก และคาบที่ได้จริง</h2>
          <p className="intro-copy">
            กดชื่อวิชาหรือชื่อบริษัทเพื่อไปแก้ช่วงที่สะดวกของรายการนั้นได้ทันที
          </p>
        </div>
        <div className="intro-badges">
          <span className="scope-chip">
            <span className="scope-chip-label">วิชาทั้งหมด</span> {formatNumber(plan.courses.length)}
          </span>
        </div>
      </div>

      <section className="panel table-panel">
        <div className="filters filters-list">
          <label>
            ค้นหาวิชา ผู้สอน บริษัท หรือหมวด
            <input
              type="search"
              value={search}
              placeholder="เช่น Cloud, อาจารย์ธนา, Soft Square, ปัญญาประดิษฐ์"
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
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
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </>
        )}
      </section>
    </PlanShell>
  );
}
