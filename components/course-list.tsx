"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { ChecklistCode } from "@/components/checklist-code";
import { dayFilter, periodFilter } from "@/lib/filter-values.ts";
import { EmptyResult } from "@/components/empty-result";
import { FilterSummary } from "@/components/filter-summary";
import { Pager } from "@/components/pager";
import { PlanShell } from "@/components/plan-shell";
import { ResultAnnouncer } from "@/components/result-announcer";
import { SlotFilters, matchesSlotFilter } from "@/components/slot-filters";
import {
  CHECKLIST_FIELDS,
  DONE_LABELS,
  DONE_ORDER,
  RECEIPT_LABELS,
  RECEIPT_ORDER,
  checklistPatch,
  checklistTone,
  isChecklistComplete,
  type ChecklistField,
  type CourseChecklist,
} from "@/lib/checklist.ts";
import {
  buildChecklistWorkbook,
  buildCourseWorkbook,
  courseFileName,
  type ExportContext,
} from "@/lib/course-export.ts";
import { formatNumber } from "@/lib/format";
import { DAY_COLORS } from "@/lib/day-colors.ts";
import { DAY_LABELS, PERIODS, parseSlotId, slotLabel, type DayKey, type PeriodKey, type SlotId } from "@/lib/slots.ts";
import type { ArchivedTerm, PlacedPeriod, PlanPayload, TermMeta } from "@/lib/plan-types.ts";
import { usePlanState } from "@/lib/use-plan-state";
import { useUrlFilters } from "@/lib/use-url-filters";

type PlacementFilter = "all" | "placed" | "unplaced";
/** Which table the page is showing: the schedule facts, or the paperwork. */
type ViewMode = "table" | "checklist";
type ChecklistFilter = "all" | "incomplete" | "complete";

const PAGE_SIZE = 10;

/**
 * Every course as a row: what the company offered, and what it got.
 *
 * It used to sit under the board on the overview, which meant the board — the
 * thing you are actually working in — shared the page with a table you only
 * consult. On its own page the board gets the whole screen and this gets room
 * to be a proper reference list.
 *
 * It is also the one page that reads past terms. The rest of the app plans the
 * term in front of it and would have to answer "what does จัดใหม่ mean on a
 * term that ended" to show history at all; a reference list has no such
 * question, so history lands here and stays read-only.
 */
export function CourseList({
  payload,
  terms,
  archives,
}: {
  payload: PlanPayload;
  terms: TermMeta[];
  archives: ArchivedTerm[];
}) {
  const plan = usePlanState(payload);
  const currentTerm = useMemo(() => terms.find((term) => term.status === "CURRENT") ?? terms[0], [terms]);

  const [termId, setTermId] = useState(currentTerm.id);
  const [search, setSearch] = useState("");
  const [day, setDay] = useState<DayKey | "">("");
  const [period, setPeriod] = useState<PeriodKey | "">("");
  const [placement, setPlacement] = useState<PlacementFilter>("all");
  const [view, setView] = useState<ViewMode>("table");
  const [checklistFilter, setChecklistFilter] = useState<ChecklistFilter>("all");
  const [page, setPage] = useState(1);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  /** null while the current term is selected — the planner's own data. */
  const archive = useMemo(() => archives.find((item) => item.term.id === termId) ?? null, [archives, termId]);

  /**
   * The checklist belongs to the term being worked on.
   *
   * A finished term's paperwork was either done or it was not, and either way
   * nobody is going to tick a box about it now — so a past term shows the
   * plain table and the switch disappears rather than offering a form that
   * saves answers about a term nobody can act on.
   */
  const checklistView = view === "checklist" && !archive;

  useUrlFilters(
    {
      q: search,
      day,
      period,
      placement: !archive && !checklistView && placement !== "all" ? placement : "",
      term: termId === currentTerm.id ? "" : termId,
      view: checklistView ? "checklist" : "",
      done: checklistView && checklistFilter !== "all" ? checklistFilter : "",
    },
    (found) => {
      setSearch(found.q ?? "");
      setDay(dayFilter(found.day));
      setPeriod(periodFilter(found.period));
      setPlacement(found.placement === "placed" || found.placement === "unplaced" ? found.placement : "all");
      setView(found.view === "checklist" ? "checklist" : "table");
      setChecklistFilter(found.done === "incomplete" || found.done === "complete" ? found.done : "all");
      setTermId(terms.some((term) => term.id === found.term) ? found.term : currentTerm.id);
      setPage(1);
    },
  );

  const roomsById = useMemo(() => new Map(plan.rooms.map((room) => [room.id, room])), [plan.rooms]);

  const courses = archive ? archive.courses : plan.courses;

  const periodsByCourse = useMemo(() => {
    const byCourse = new Map<string, PlacedPeriod[]>();
    const add = (courseId: string, entry: PlacedPeriod) => {
      const list = byCourse.get(courseId);
      if (list) list.push(entry);
      else byCourse.set(courseId, [entry]);
    };

    if (archive) {
      for (const session of archive.sessions) {
        // The room is the name it had that term, not a lookup into today's
        // room list — see `ArchivedSession` for why.
        add(session.courseId, {
          key: `${session.courseId}@${session.slotId}`,
          slotId: session.slotId,
          roomLabel: session.roomName,
          locked: false,
        });
      }
    } else {
      for (const item of plan.assignments) {
        add(item.courseId, {
          key: item.id,
          slotId: item.slotId,
          roomLabel: item.roomId ? roomsById.get(item.roomId)?.name ?? item.roomId : null,
          locked: item.locked,
        });
      }
    }
    return byCourse;
  }, [archive, plan.assignments, roomsById]);

  const rows = useMemo(() => {
    // One box for course, lecturer, company and category. Four separate
    // controls asked the reader to know which field a word lived in before
    // they could look it up, which is a question the box can answer itself.
    const needle = deferredSearch.trim().toLowerCase();
    return courses
      .map((course) => ({
        course,
        placed: periodsByCourse.get(course.id) ?? [],
        // Read for every row even in the plain table: it costs a lookup, and
        // it keeps the two views reading from one source rather than each
        // deciding for itself what "this course's checklist" means.
        checklist: plan.checklistFor(course.id),
      }))
      .filter(({ course, placed, checklist }) => {
        if (!matchesSlotFilter(course.availability, day, period)) return false;
        // Only the current term has a "still to do" state; in a finished term
        // every course listed is a course that ran.
        if (!archive && !checklistView) {
          if (placement === "placed" && placed.length < course.sessionsPerWeek) return false;
          if (placement === "unplaced" && placed.length >= course.sessionsPerWeek) return false;
        }
        if (checklistView && checklistFilter !== "all" && editingCode !== course.id) {
          const complete = isChecklistComplete(checklist);
          if (checklistFilter === "complete" && !complete) return false;
          if (checklistFilter === "incomplete" && complete) return false;
        }
        if (!needle) return true;
        return [course.title, course.courseCode, course.provider, course.instructor, course.category]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [
    courses,
    periodsByCourse,
    archive,
    deferredSearch,
    day,
    period,
    placement,
    checklistView,
    checklistFilter,
    editingCode,
    plan,
  ]);

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
    !archive && !checklistView && placement !== "all"
      ? {
          label: "สถานะ",
          value: placement === "placed" ? "จัดแล้ว" : "ยังไม่ได้จัด",
          onClear: () => setPlacement("all"),
        }
      : null,
    checklistView && checklistFilter !== "all"
      ? {
          label: "เช็กลิสต์",
          value: checklistFilter === "complete" ? "ครบแล้ว" : "ยังทำไม่ครบ",
          onClear: () => setChecklistFilter("all"),
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const clearFilters = () => {
    setSearch("");
    setDay("");
    setPeriod("");
    setPlacement("all");
    setChecklistFilter("all");
  };

  /** The term is a scope, not a filter: the search box narrows within it. */
  const changeTerm = (nextId: string) => {
    setTermId(nextId);
    setPage(1);
    setPlacement("all");
  };

  const changeView = (next: ViewMode) => {
    setView(next);
    setPlacement("all");
    setEditingCode(null);
    setPage(1);
  };

  /** One cell of the checklist table: a status to pick, or a code to type. */
  const checklistControl = (courseId: string, courseTitle: string, checklist: CourseChecklist, field: ChecklistField) => {
    if (field.kind === "code") {
      return (
        <ChecklistCode
          value={checklist.mcvJoinCode}
          label={`${field.label} — ${courseTitle}`}
          onChange={(value) => { void plan.setChecklistField(courseId, checklistPatch(field, value)); }}
          onEditing={(editing) => setEditingCode(editing ? courseId : null)}
        />
      );
    }
    const options = field.kind === "receipt" ? RECEIPT_ORDER : DONE_ORDER;
    const labels: Record<string, string> = field.kind === "receipt" ? RECEIPT_LABELS : DONE_LABELS;
    return (
      <select
        className={`checklist-select tone-${checklistTone(checklist, field)}`}
        value={checklist[field.key]}
        aria-label={`${field.label} — ${courseTitle}`}
        onChange={(event) => plan.setChecklistField(courseId, checklistPatch(field, event.target.value))}
      >
        {options.map((option) => (
          <option key={option} value={option}>{labels[option]}</option>
        ))}
      </select>
    );
  };

  /**
   * Download what is on screen as .xlsx — every filtered row, not just the
   * page being shown, because the page is a reading convenience and nobody
   * asks for "the ten courses I can currently see" in a spreadsheet.
   *
   * The file is built here in the browser: these pages are statically
   * rendered and there is no server to ask, and a term's worth of courses is
   * a few dozen rows either way.
   */
  const downloadXlsx = () => {
    const context: ExportContext = {
      term: archive ? archive.term : currentTerm,
      isArchived: archive !== null,
      filters: activeFilters.map((filter) => (filter.value ? `${filter.label}: ${filter.value}` : filter.label)),
      dataUpdated: archive ? archive.lastUpdated : payload.lastUpdated,
      isMock: archive ? archive.isMock : payload.isMock,
      timezone: payload.timezone,
      exportedAt: new Date(),
    };

    // The button exports what is on screen. Someone who switched to the
    // checklist wants the checklist; handing them the schedule columns would
    // be the app disagreeing with itself about which table it is showing.
    const bytes = checklistView ? buildChecklistWorkbook(context, rows) : buildCourseWorkbook(context, rows);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = courseFileName(context, checklistView ? "checklist" : "table");
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked a tick later: revoking in the same task cancels the download in
    // Safari, which has not read the blob yet when click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <PlanShell
      eyebrow="NextLink"
      title="รายวิชาเลือก"
      lastUpdated={archive ? archive.lastUpdated : payload.lastUpdated}
      timezone={payload.timezone}
      isMock={archive ? archive.isMock : payload.isMock}
      // Local edits belong to the term being planned; saying "แก้ไขไว้ในเครื่องนี้"
      // over a term that ended would point at edits this page is not showing.
      editedAt={archive ? null : plan.editedAt}
      onReset={plan.resetAll}
    >
      <div className="intro-row">
        <div>
          <p className="section-kicker">รายวิชา</p>
          <h2>{archive ? "วิชาที่เปิดจริง และคาบที่สอนจริง" : "ช่วงที่บริษัทสะดวก และคาบที่ได้จริง"}</h2>
          <p className="intro-copy">
            {archive
              ? `${archive.term.label} — เทอมที่ปิดไปแล้ว ดูได้อย่างเดียว`
              : "กดชื่อวิชาหรือชื่อบริษัทเพื่อไปแก้ช่วงที่สะดวกของรายการนั้นได้ทันที"}
          </p>
        </div>
        <div className="intro-badges">
          <label className="term-switcher">
            <span className="term-switcher-label">เทอม / ปีการศึกษา</span>
            <select value={termId} onChange={(event) => changeTerm(event.target.value)}>
              {terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}{term.status === "CURRENT" ? " · กำลังจัด" : ""}
                </option>
              ))}
            </select>
          </label>
          <span className="scope-chip">
            <span className="scope-chip-label">วิชาทั้งหมด</span> {formatNumber(courses.length)}
          </span>
        </div>
      </div>

      <section className="panel table-panel">
        {/* Two tables, one page. The schedule facts and the paperwork are
            about the same list of courses and are read by the same person on
            the same afternoon, so they share the search box, the term and the
            export button rather than living on two pages that drift apart.
            A finished term has no paperwork left to do, so it gets no switch. */}
        {archive ? null : (
          <div className="view-switch" role="group" aria-label="รูปแบบตาราง">
            <button
              className={`view-switch-button${checklistView ? "" : " is-active"}`}
              type="button"
              aria-pressed={!checklistView}
              onClick={() => changeView("table")}
            >
              ตารางรายวิชา
            </button>
            <button
              className={`view-switch-button${checklistView ? " is-active" : ""}`}
              type="button"
              aria-pressed={checklistView}
              onClick={() => changeView("checklist")}
            >
              เช็กลิสต์งานเอกสาร
            </button>
          </div>
        )}
        <div className={`filters ${archive ? "filters-archive" : "filters-list"}`}>
          <label>
            ค้นหาวิชา ผู้สอน บริษัท หรือหมวด
            <input
              type="search"
              value={search}
              placeholder="พิมพ์ชื่อวิชา, ชื่ออาจารย์, ชื่อบริษัท, หมวดหมู่"
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </label>
          {/* Every course in a finished term ran, so a "จัดครบแล้ว / ยังจัดไม่ครบ"
              control there would be a filter with one possible answer. In the
              checklist the same slot asks the question that view is for. */}
          {archive ? null : checklistView ? (
            <label>
              สถานะเช็กลิสต์
              <select
                value={checklistFilter}
                onChange={(event) => { setChecklistFilter(event.target.value as ChecklistFilter); setPage(1); }}
              >
                <option value="all">ทั้งหมด</option>
                <option value="incomplete">ยังทำไม่ครบ</option>
                <option value="complete">ครบแล้ว</option>
              </select>
            </label>
          ) : (
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
          )}
          <SlotFilters
            day={day}
            period={period}
            onDay={(next) => { setDay(next); setPage(1); }}
            onPeriod={(next) => { setPeriod(next); setPage(1); }}
          />
        </div>
        <div className="list-toolbar">
          <FilterSummary summary={`พบ ${formatNumber(rows.length)} วิชา`} filters={activeFilters} />
          <button
            className="secondary-button"
            type="button"
            onClick={downloadXlsx}
            disabled={rows.length === 0}
            title={`ดาวน์โหลด ${formatNumber(rows.length)} วิชาที่แสดงอยู่เป็นไฟล์ Excel`}
          >
            ดาวน์โหลด Excel
          </button>
        </div>

        <ResultAnnouncer message={`พบ ${rows.length} วิชา ใน${archive ? archive.term.label : currentTerm.label}`} />
        {rows.length === 0 ? (
          <EmptyResult message="ไม่พบวิชาที่ตรงกับตัวกรอง" hasFilters={activeFilters.length > 0} onClear={clearFilters} />
        ) : (
          <>
            <div className="table-wrap">
              {checklistView ? (
              /* Course and company stay, so a row is still recognisable as the
                 same row in either view; everything after them is the work
                 itself. Seven controls in a row is a lot of table, which is
                 why the columns are headed with a phrase and the full step is
                 on the control's own label for anyone who needs it read out. */
              <table className="checklist-table">
                {/* Declared widths, not measured ones. The table is laid out
                    fixed so every status column is the same width whatever is
                    inside it — otherwise the two columns holding the longest
                    answer come out wider than the rest, and a row of controls
                    that should read as one row of the same thing reads as
                    several. Percentages so the whole thing still fits when a
                    sidebar takes a slice of the page. */}
                <colgroup>
                  <col style={{ width: "17%" }} />
                  <col style={{ width: "9%" }} />
                  {CHECKLIST_FIELDS.map((field) => (
                    <col key={field.key} style={{ width: field.kind === "code" ? "8%" : "11%" }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">วิชา</th>
                    <th scope="col">บริษัท</th>
                    {CHECKLIST_FIELDS.map((field) => (
                      <th scope="col" key={field.key} title={field.label}>{field.short}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ course, checklist }) => (
                    <tr key={course.id} className={isChecklistComplete(checklist) ? "is-complete" : undefined}>
                      <td>
                        <Link className="course-link" href={`/courses?q=${encodeURIComponent(course.title)}`}>
                          <strong>{course.title}</strong>
                          <span className="course-code">{course.courseCode} · {course.category}</span>
                        </Link>
                      </td>
                      <td><span className="schedule-text">{course.provider}</span></td>
                      {CHECKLIST_FIELDS.map((field) => (
                        <td key={field.key}>{checklistControl(course.id, course.title, checklist, field)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              ) : (
              <table>
                <thead>
                  <tr>
                    <th scope="col">วิชา</th>
                    <th scope="col">บริษัท</th>
                    <th scope="col">ผู้สอน</th>
                    <th scope="col">{archive ? "ช่วงที่แจ้งไว้" : "ช่วงที่สะดวก"}</th>
                    <th scope="col">{archive ? "คาบที่สอน" : "คาบที่ได้"}</th>
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
                            the answer lives on the availability page. That page
                            only knows the term being planned, so a past term's
                            rows are plain text rather than links into it. */}
                        {archive ? (
                          <span className="course-link is-static">
                            <strong>{course.title}</strong>
                            <span className="course-code">{course.courseCode} · {course.category}</span>
                          </span>
                        ) : (
                          <Link className="course-link" href={`/courses?q=${encodeURIComponent(course.title)}`}>
                            <strong>{course.title}</strong>
                            <span className="course-code">{course.courseCode} · {course.category}</span>
                          </Link>
                        )}
                      </td>
                      <td>
                        {archive ? (
                          <span className="schedule-text">{course.provider}</span>
                        ) : (
                          <Link className="provider-link" href={`/courses?provider=${encodeURIComponent(course.provider)}`}>
                            {course.provider}
                          </Link>
                        )}
                      </td>
                      <td><span className="schedule-text">{course.instructor}</span></td>
                      <td>
                        {course.availability.length === 0 ? (
                          <span className="status-pill tone-orange">ยังไม่ได้แจ้ง</span>
                        ) : (
                          <span className="day-chip-list">
                            {course.availability.map((slotId: SlotId) => {
                              const colour = DAY_COLORS[parseSlotId(slotId).day];
                              return (
                                <span
                                  className="day-chip"
                                  key={slotId}
                                  style={{
                                    ["--day-ink" as string]: colour.ink,
                                    ["--day-bg" as string]: colour.bg,
                                    ["--day-border" as string]: colour.border,
                                  }}
                                >
                                  {slotLabel(slotId)}
                                </span>
                              );
                            })}
                          </span>
                        )}
                      </td>
                      <td>
                        {placed.length === 0 ? (
                          <span className="status-pill tone-orange">ยังไม่ได้จัด</span>
                        ) : (
                          /* Same day colours as the column beside it, so the two
                             can be compared at a glance — which is the whole
                             reason they sit next to each other. The lock is what
                             the old green/blue split used to carry; it stays as a
                             glyph rather than a colour, because colour is now
                             saying which day. Nothing in a past term is locked:
                             a record cannot be moved, so a lock on every chip
                             would mark a distinction that no longer exists. */
                          <span className="day-chip-list">
                            {placed.map((item) => {
                              const colour = DAY_COLORS[parseSlotId(item.slotId).day];
                              return (
                                <span
                                  className={`day-chip${item.locked ? " is-locked" : ""}`}
                                  key={item.key}
                                  style={{
                                    ["--day-ink" as string]: colour.ink,
                                    ["--day-bg" as string]: colour.bg,
                                    ["--day-border" as string]: colour.border,
                                  }}
                                >
                                  {item.locked ? <span className="day-chip-lock" aria-hidden="true">🔒</span> : null}
                                  {slotLabel(item.slotId)}
                                  {item.locked ? <span className="sr-only"> — ยืนยันแล้ว</span> : null}
                                </span>
                              );
                            })}
                          </span>
                        )}
                        {placed.length < course.sessionsPerWeek ? (
                          <small>ต้องได้ {course.sessionsPerWeek} คาบ/สัปดาห์</small>
                        ) : null}
                      </td>
                      <td>
                        {course.deliveryMode === "ONLINE" ? (
                          <span className="room-tag">ออนไลน์</span>
                        ) : placed.length === 0 ? (
                          <span className="schedule-text">—</span>
                        ) : (
                          <span className="status-stack">
                            {placed.map((item) => (
                              <span className="room-tag" key={item.key}>
                                {item.roomLabel ?? "ยังไม่มีห้อง"}
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
              )}
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
