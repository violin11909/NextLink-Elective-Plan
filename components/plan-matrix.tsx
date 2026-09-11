"use client";

import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { formatNumber, personName } from "@/lib/format";
import { placementBlockers } from "@/lib/scheduler.ts";
import { DAYS, DAY_LABELS, PERIODS, PERIOD_KEYS, makeSlotId, slotLabel, type SlotId } from "@/lib/slots.ts";
import type { Assignment, BlockerCode, PlanCourse, PlanRoom } from "@/lib/plan-types.ts";

/** The column for classes that occupy no room at all. */
const ONLINE_COLUMN = "__online__";
import type { Conflict } from "@/lib/conflicts.ts";

type Held = { kind: "assignment"; id: string; courseId: string } | { kind: "course"; id: string };

/**
 * The whole plan as one board: a column per room, a row per period.
 *
 * This replaces the day-by-day grid it grew out of. That one could show *when*
 * a class met but had to name the room inside every card to say where, which is
 * the thing a room column says for free — and it could not answer "what else is
 * in this room on Wednesday", which is the question you are holding in your
 * head while you move something.
 *
 * Classes move by dragging, and the same moves are available from the keyboard:
 * press ย้าย on a card (or เลือก on a card in the tray) and every period turns
 * into a button. Drag-only would put the one thing this board is for out of
 * reach of a keyboard and off a phone entirely.
 */
export function PlanMatrix({
  rooms,
  courses,
  assignments,
  conflicts,
  unplaced,
  onPlace,
  onMove,
  onToggleLock,
  onRemove,
  onBlockedDrop,
  onHeldChange,
  onEditRoom,
  onBookSlot,
}: {
  rooms: PlanRoom[];
  courses: PlanCourse[];
  assignments: Assignment[];
  conflicts: Conflict[];
  unplaced: Array<{ course: PlanCourse; missing: number }>;
  onPlace: (courseId: string, slotId: SlotId, roomId: string | null) => Promise<boolean>;
  onMove: (assignmentId: string, slotId: SlotId, roomId: string | null) => Promise<boolean>;
  onToggleLock: (assignmentId: string) => void;
  onRemove: (assignmentId: string) => void;
  /** Called when a drop lands somewhere the rules object to, so the page can say so. */
  onBlockedDrop: (courseTitle: string, slotId: SlotId, blockers: BlockerCode[], roomIgnored: boolean) => void;
  /** Lets the page put the "you are placing X" note in its heading. Shown
   *  inside the board it appeared and disappeared above the table, moving
   *  every row down and then back the moment a drag started. */
  onHeldChange?: (course: PlanCourse | null) => void;
  /** Opens the room form for one column — where a room is also renamed or removed. */
  onEditRoom: (room: PlanRoom) => void;
  /** Opens the booking form for one cell. `reason` is what it holds today, if any. */
  onBookSlot: (room: PlanRoom, slotId: SlotId, reason: string | null) => void;
}) {
  const [held, setHeld] = useState<Held | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const coursesById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

  /* Building on the first line, the rest of the name on the second. One line of
     "จุฬาพัฒน์ 4 โถงกลาง ชั้น 3" in a 130px column wrapped wherever it landed. */
  const columns = useMemo(
    () => [
      ...rooms.map((room) => {
        // "ตึก 4 (คณะวิศวะ)" and "ตึก 4 ชั้น 17 ห้อง 17-02" share only the part
        // before the parenthesis, so strip on that rather than the whole label.
        const prefix = room.building.split(" (")[0];
        return {
          key: room.id,
          room,
          label: room.building,
          detail: room.name.startsWith(prefix) ? room.name.slice(prefix.length).trim() : room.name,
        };
      }),
      { key: ONLINE_COLUMN, room: null, label: "ออนไลน์", detail: "" },
    ],
    [rooms],
  );

  const heldCourse = held
    ? coursesById.get(held.kind === "assignment" ? held.courseId : held.id) ?? null
    : null;

  useEffect(() => {
    onHeldChange?.(heldCourse);
  }, [heldCourse, onHeldChange]);

  const roomIdFor = (course: PlanCourse, columnKey: string) =>
    course.deliveryMode === "ONLINE" || columnKey === ONLINE_COLUMN ? null : columnKey;

  /** What the rules say about putting the held course in this cell, live. */
  const blockersAt = (course: PlanCourse, slotId: SlotId, columnKey: string, ignoreAssignmentId?: string) =>
    placementBlockers({
      course,
      courses,
      rooms,
      placed: assignments.filter((item) => item.id !== ignoreAssignmentId),
      slotId,
      roomId: roomIdFor(course, columnKey),
    });

  /**
   * True when the drop names a room but the class cannot take one.
   *
   * An online class holds no room, so the column is dropped and the card lands
   * back in the online column. Reporting that as a rule the drop broke read as
   * nonsense — it named whatever else happened to be wrong with the period,
   * never the reason the card moved back.
   */
  const roomWouldBeIgnored = (course: PlanCourse, columnKey: string) =>
    course.deliveryMode === "ONLINE" && columnKey !== ONLINE_COLUMN;

  const drop = async (slotId: SlotId, columnKey: string, item: Held) => {
    const course = coursesById.get(item.kind === "assignment" ? item.courseId : item.id);
    if (!course) return;
    const ignore = item.kind === "assignment" ? item.id : undefined;
    const blockers = blockersAt(course, slotId, columnKey, ignore);
    const roomId = roomIdFor(course, columnKey);
    const roomIgnored = roomWouldBeIgnored(course, columnKey);

    const saved = item.kind === "assignment" ? await onMove(item.id, slotId, roomId) : await onPlace(course.id, slotId, roomId);
    if (!saved) return;

    // Dropped anyway, then told why. Refusing the drop outright would mean a
    // coordinator who has just been given a new time on the phone cannot record
    // it until the data catches up, and that is how a planner gets abandoned.
    if (blockers.length > 0 || roomIgnored) onBlockedDrop(course.title, slotId, blockers, roomIgnored);
    setHeld(null);
    setHover(null);
  };

  const cellState = (slotId: SlotId, columnKey: string) => {
    if (!heldCourse || !held) return "";
    const ignore = held.kind === "assignment" ? held.id : undefined;
    if (held.kind === "assignment") {
      const current = assignments.find((item) => item.id === held.id);
      if (current && current.slotId === slotId && (current.roomId ?? ONLINE_COLUMN) === columnKey) return "";
    }
    if (roomWouldBeIgnored(heldCourse, columnKey)) return " is-drop-blocked";
    return blockersAt(heldCourse, slotId, columnKey, ignore).length === 0 ? " is-drop-ok" : " is-drop-blocked";
  };

  const blockingFor = (assignmentId: string) =>
    conflicts.filter((item) => item.severity === "BLOCKED" && item.assignmentIds.includes(assignmentId));
  const hasBlockingConflict = (assignmentId: string) => blockingFor(assignmentId).length > 0;

  return (
    <div className="matrix-block">
      {/*
       * The unplaced courses live in a layer that follows the viewport rather
       * than a strip pinned above the board. The board is now as tall as the
       * week, so the empty period you are looking for is usually a long way
       * from wherever the list would have sat — and a course you cannot see is
       * a course you cannot drag.
       */}
      {unplaced.length > 0 && !pickerOpen ? (
        <button className="picker-fab" type="button" onClick={() => setPickerOpen(true)}>
          <span aria-hidden="true">＋</span>
          เพิ่มวิชาเข้าตาราง
          <span className="picker-fab-count">{formatNumber(unplaced.length)}</span>
        </button>
      ) : null}

      {pickerOpen ? (
        <div className="picker-bar" role="group" aria-label="วิชาที่ยังไม่ได้จัด">
          <div className="picker-bar-head">
            <strong>ยังไม่ได้จัด</strong>
            <span className="count-chip">{formatNumber(unplaced.length)} วิชา</span>
            <span className="picker-bar-hint">ลากลงช่องว่างในตาราง หรือกด ⤓ แล้วเลือกช่อง</span>
            <button
              className="picker-bar-close"
              type="button"
              onClick={() => { setPickerOpen(false); setHeld(null); }}
            >
              ซ่อนรายการ
            </button>
          </div>
          {unplaced.length === 0 ? (
            <p className="matrix-tray-empty">จัดครบทุกวิชาแล้ว</p>
          ) : (
            <ul className="picker-list">
              {unplaced.map(({ course, missing }) => {
                const isHeld = held?.kind === "course" && held.id === course.id;
                return (
                  <li key={course.id}>
                    <div
                      className={`tray-chip${isHeld ? " is-held" : ""}`}
                      draggable
                      onDragStart={(event) => {
                        const payload: Held = { kind: "course", id: course.id };
                        event.dataTransfer.setData("text/plain", JSON.stringify(payload));
                        event.dataTransfer.effectAllowed = "move";
                        setHeld(payload);
                      }}
                      onDragEnd={() => { setHeld(null); setHover(null); }}
                    >
                      <span className="tray-chip-copy">
                        <strong>{course.title}</strong>
                        <small>{course.provider} · ต้องได้ {formatNumber(missing)} คาบ</small>
                        <small>{personName(course.instructor)}</small>
                        {/* Its own line: run on from the company name, a period
                            like "อังคารบ่าย" broke across two lines mid-word. */}
                        <small className="tray-chip-slots">
                          {course.availability.map(slotLabel).join(" / ") || "ยังไม่แจ้งช่วงที่สะดวก"}
                        </small>
                      </span>
                      <button
                        className={`chip-action${isHeld ? " is-on" : ""}`}
                        type="button"
                        aria-pressed={isHeld}
                        onClick={() => setHeld(isHeld ? null : { kind: "course", id: course.id })}
                      >
                        <span aria-hidden="true">⤓</span>
                        <span className="sr-only">
                          {isHeld ? `ยกเลิกการเลือก ${course.title}` : `เลือก ${course.title} เพื่อวางลงตาราง`}
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <div className="matrix-scroll">
        <table className="matrix">
          <caption className="sr-only">ตารางห้องเรียนทั้งสัปดาห์ คอลัมน์เป็นห้อง แถวเป็นคาบของแต่ละวัน</caption>
          <thead>
            <tr>
              <th className="matrix-corner" scope="col">คาบ</th>
              {columns.map((column) => {
                const room = column.room;
                return (
                <th className="matrix-room" key={column.key} scope="col">
                  <span>{column.label}</span>
                  {column.detail ? <small>{column.detail}</small> : null}
                  {/* The column header is where a room already names itself, so
                      it is where changing or removing that room belongs — the
                      alternative is reading the board here and editing it on
                      another page, matching rooms by name in your head. */}
                  {room ? (
                    <button
                      className="matrix-room-edit"
                      type="button"
                      title={`แก้ไข ${room.name}`}
                      onClick={() => onEditRoom(room)}
                    >
                      <span aria-hidden="true">✎</span>
                      <span className="sr-only">แก้ไขห้อง {room.name}</span>
                    </button>
                  ) : null}
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => (
              <Fragment key={day}>
                <tr className="matrix-day">
                  {/* The label is stuck to the left edge separately from its
                      cell: the cell spans the whole board, so pinning the cell
                      keeps a box on screen whose text is still two thousand
                      pixels to the left. */}
                  <th colSpan={columns.length + 1} scope="colgroup">
                    <span className="matrix-day-label">{DAY_LABELS[day]}</span>
                  </th>
                </tr>
                {PERIOD_KEYS.map((period) => {
                  const slotId = makeSlotId(day, period);
                  return (
                    <tr key={slotId}>
                      <th className="matrix-slot" scope="row">
                        <strong>{PERIODS[period].label}</strong>
                        <small>{PERIODS[period].start}–{PERIODS[period].end}</small>
                      </th>
                      {columns.map((column) => {
                        const cellKey = `${slotId}:${column.key}`;
                        const room = column.room;
                        const blocked = room?.blockedSlots.find((entry) => entry.slotId === slotId);
                        const here = assignments.filter(
                          (item) => item.slotId === slotId && (item.roomId ?? ONLINE_COLUMN) === column.key,
                        );
                        // The cell is the target, so it carries the verdict as a
                        // class and CSS paints it on hover. A dedicated "drop here"
                        // button inside every cell said the same thing in far more
                        // ink, and made the board unreadable while anything was held.
                        const state = heldCourse && !blocked ? cellState(slotId, column.key) : "";
                        const takesDrop = Boolean(state);
                        return (
                          <td
                            className={`matrix-cell${blocked ? " is-blocked" : ""}${state}${hover === cellKey ? " is-drop-hovered" : ""}`}
                            key={column.key}
                            /* Only while something is held: an empty board should
                               not put 180 stops in the tab order. */
                            {...(takesDrop
                              ? {
                                  role: "button",
                                  tabIndex: 0,
                                  "aria-label": `วาง ${heldCourse?.title ?? ""} ที่ ${column.label} ${slotLabel(slotId)}`,
                                  onClick: () => held && drop(slotId, column.key, held),
                                  onKeyDown: (event: KeyboardEvent<HTMLTableCellElement>) => {
                                    if (event.key !== "Enter" && event.key !== " ") return;
                                    event.preventDefault();
                                    if (held) drop(slotId, column.key, held);
                                  },
                                }
                              : {})}
                            onDragOver={(event) => {
                              if (blocked) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              setHover(cellKey);
                            }}
                            onDragLeave={() => setHover((current) => (current === cellKey ? null : current))}
                            onDrop={(event) => {
                              event.preventDefault();
                              try {
                                drop(slotId, column.key, JSON.parse(event.dataTransfer.getData("text/plain")) as Held);
                              } catch {
                                // A drag from outside the board carries no payload we can use.
                              }
                            }}
                          >
                            {/* The booking is a button, not a label: whoever is
                                looking at the period it holds is the person who
                                knows whether it still holds, and making them go
                                elsewhere to release it is how a board fills up
                                with holds nobody dares touch. */}
                            {blocked && room ? (
                              <button
                                className="matrix-blocked"
                                type="button"
                                title={`แก้ไขหรือปลดการกัน ${room.name} ${slotLabel(slotId)}`}
                                onClick={(event) => { event.stopPropagation(); onBookSlot(room, slotId, blocked.reason); }}
                              >
                                <span className="matrix-blocked-tag">กันไว้</span>
                                <small>{blocked.reason}</small>
                              </button>
                            ) : null}
                            {here.map((assignment) => {
                              const course = coursesById.get(assignment.courseId);
                              if (!course) return null;
                              const isHeld = held?.kind === "assignment" && held.id === assignment.id;
                              return (
                                <div
                                  className={`matrix-chip${assignment.locked ? " is-locked" : ""}${hasBlockingConflict(assignment.id) ? " is-conflict" : ""}${isHeld ? " is-held" : ""}`}
                                  key={assignment.id}
                                  /*
                                   * Built exactly like the tray chip above: a plain
                                   * draggable <div> wrapping inert copy. Nothing
                                   * between the text and this element may take the
                                   * press — a <button>, or a span given role and
                                   * tabindex, becomes the event target and browsers
                                   * disagree about whether such an element may act
                                   * as the drag source for a draggable ancestor,
                                   * which is what left the middle of the card (the
                                   * course title) undraggable while its bare edges
                                   * worked. The card itself carries the drag, the
                                   * click and the keyboard action, so every pixel
                                   * that is not one of the two corner buttons
                                   * behaves the same.
                                   */
                                  draggable={!assignment.locked}
                                  /*
                                   * No tabindex and no role, exactly like the tray
                                   * chip. Making the card focusable put a focus on
                                   * every mousedown, and a press that focuses now
                                   * and then fails to become a drag — measured at
                                   * roughly one press in ten, which is what "the
                                   * card sometimes will not drag" was. The keyboard
                                   * path lives in .chip-pick below instead, so
                                   * pressing the card only ever starts a drag.
                                   */
                                  title={assignment.locked ? "ปลดล็อกก่อนจึงจะย้ายได้" : "ลากเพื่อย้าย หรือกดเพื่อหยิบขึ้นแล้วเลือกช่องปลายทาง"}
                                  onDragStart={(event) => {
                                    const payload: Held = { kind: "assignment", id: assignment.id, courseId: course.id };
                                    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
                                    event.dataTransfer.effectAllowed = "move";
                                    setHeld(payload);
                                  }}
                                  onDragEnd={() => { setHeld(null); setHover(null); }}
                                  /*
                                   * Clicking picks the class up so a target period
                                   * can be chosen — the path a keyboard needs, since
                                   * a drag cannot be performed with one.
                                   */
                                  onClick={(event) => {
                                    if (assignment.locked) return;
                                    // While a different class is held, this card is
                                    // just part of its cell's drop area — let the
                                    // click through so the cell takes the drop. Only
                                    // the card's own pick-up and cancel are kept from
                                    // the cell, which would otherwise drop the class
                                    // straight back where it started.
                                    if (held && !isHeld) return;
                                    event.stopPropagation();
                                    setHeld(isHeld ? null : { kind: "assignment", id: assignment.id, courseId: course.id });
                                  }}
                                >
                                  {/* Real buttons, like the tray chip's own action.
                                      They stop the click so the card does not also
                                      pick the class up underneath them. */}
                                  <button
                                    className="chip-remove"
                                    type="button"
                                    title="เอาออกจากตาราง"
                                    onClick={(event) => { event.stopPropagation(); onRemove(assignment.id); }}
                                  >
                                    <span aria-hidden="true">×</span>
                                    <span className="sr-only">เอา {course.title} ออกจากตาราง</span>
                                  </button>
                                  <span className="matrix-chip-copy">
                                    <strong>{course.title}</strong>
                                    <small>{course.provider}</small>
                                    <small>{personName(course.instructor)}</small>
                                  </span>
                                  {/*
                                    * The keyboard's way in, and the only focusable
                                    * thing in the card body. Hidden until it is
                                    * focused, where it becomes an ordinary button —
                                    * a drag cannot be performed with a keyboard, so
                                    * without this the main action on the page would
                                    * be mouse-only.
                                    */}
                                  {assignment.locked ? null : (
                                    <button
                                      className="chip-pick"
                                      type="button"
                                      aria-pressed={isHeld}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setHeld(isHeld ? null : { kind: "assignment", id: assignment.id, courseId: course.id });
                                      }}
                                    >
                                      {isHeld ? `ยกเลิกการย้าย ${course.title}` : `หยิบ ${course.title} ขึ้นเพื่อย้ายไปช่องอื่น`}
                                    </button>
                                  )}
                                  <span className="chip-actions">
                                    <button
                                      className={`chip-action${assignment.locked ? " is-on" : ""}`}
                                      type="button"
                                      aria-pressed={assignment.locked}
                                      title={assignment.locked ? "ปลดล็อกคาบนี้" : "ล็อกคาบนี้ไม่ให้ระบบย้าย"}
                                      onClick={(event) => { event.stopPropagation(); onToggleLock(assignment.id); }}
                                    >
                                      <span aria-hidden="true">{assignment.locked ? "🔒" : "🔓"}</span>
                                      <span className="sr-only">
                                        {assignment.locked ? `ปลดล็อก ${course.title}` : `ล็อก ${course.title}`}
                                      </span>
                                    </button>
                                  </span>
                                </div>
                              );
                            })}
                            {/* Same as the per-room grid: a red border says
                                something is wrong, and this says what — without
                                it the reader has to match the cell against a
                                list somewhere else on the page. */}
                            {(() => {
                              const problems = [...new Set(here.flatMap((item) => blockingFor(item.id).map((c) => c.title)))];
                              return problems.length > 0 ? (
                                <p className="slot-conflict-note">{problems.join(" · ")}</p>
                              ) : null;
                            })()}
                            {/* Only on an empty period, and only while nothing
                                is being placed — otherwise this button sits
                                inside the drop target and eats the click that
                                was meant for the cell. */}
                            {room && !blocked && here.length === 0 && !heldCourse ? (
                              <button
                                className="matrix-book"
                                type="button"
                                onClick={(event) => { event.stopPropagation(); onBookSlot(room, slotId, null); }}
                              >
                                <span aria-hidden="true">กันคาบ</span>
                                <span className="sr-only">กัน {room.name} {slotLabel(slotId)} ไว้ให้วิชาอื่น</span>
                              </button>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
