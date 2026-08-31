"use client";

import { Fragment, useMemo, useState } from "react";
import { formatNumber } from "@/lib/format";
import { accentFor, buildRoomAccents, ONLINE_ACCENT, ONLINE_COLUMN } from "@/lib/room-colors.ts";
import { placementBlockers } from "@/lib/scheduler.ts";
import { DAYS, DAY_LABELS, PERIODS, PERIOD_KEYS, makeSlotId, slotLabel, type SlotId } from "@/lib/slots.ts";
import type { Assignment, BlockerCode, PlanCourse, PlanRoom } from "@/lib/plan-types.ts";
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
}: {
  rooms: PlanRoom[];
  courses: PlanCourse[];
  assignments: Assignment[];
  conflicts: Conflict[];
  unplaced: Array<{ course: PlanCourse; missing: number }>;
  onPlace: (courseId: string, slotId: SlotId, roomId: string | null) => void;
  onMove: (assignmentId: string, slotId: SlotId, roomId: string | null) => void;
  onToggleLock: (assignmentId: string) => void;
  onRemove: (assignmentId: string) => void;
  /** Called when a drop lands somewhere the rules object to, so the page can say so. */
  onBlockedDrop: (courseTitle: string, slotId: SlotId, blockers: BlockerCode[]) => void;
}) {
  const [held, setHeld] = useState<Held | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const accents = useMemo(() => buildRoomAccents(rooms), [rooms]);
  const coursesById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

  const columns = useMemo(
    () => [
      ...rooms.map((room) => ({ key: room.id, room, label: room.name, accent: accentFor(accents, room.id) })),
      { key: ONLINE_COLUMN, room: null, label: "ออนไลน์", accent: ONLINE_ACCENT },
    ],
    [rooms, accents],
  );

  const heldCourse = held
    ? coursesById.get(held.kind === "assignment" ? held.courseId : held.id) ?? null
    : null;

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

  const drop = (slotId: SlotId, columnKey: string, item: Held) => {
    const course = coursesById.get(item.kind === "assignment" ? item.courseId : item.id);
    if (!course) return;
    const ignore = item.kind === "assignment" ? item.id : undefined;
    const blockers = blockersAt(course, slotId, columnKey, ignore);
    const roomId = roomIdFor(course, columnKey);

    if (item.kind === "assignment") onMove(item.id, slotId, roomId);
    else onPlace(course.id, slotId, roomId);

    // Dropped anyway, then told why. Refusing the drop outright would mean a
    // coordinator who has just been given a new time on the phone cannot record
    // it until the data catches up, and that is how a planner gets abandoned.
    if (blockers.length > 0) onBlockedDrop(course.title, slotId, blockers);
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
    return blockersAt(heldCourse, slotId, columnKey, ignore).length === 0 ? " is-drop-ok" : " is-drop-blocked";
  };

  const hasBlockingConflict = (assignmentId: string) =>
    conflicts.some((item) => item.severity === "BLOCKED" && item.assignmentIds.includes(assignmentId));

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
              พับเก็บ
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
                        <small>
                          {course.provider} · ต้องได้ {formatNumber(missing)} คาบ ·{" "}
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

      {heldCourse ? (
        <p className="edit-mode-note matrix-holding">
          กำลังวาง <strong>{heldCourse.title}</strong> — เลือกช่องปลายทาง ช่องขอบเขียวคือวางได้ ขอบส้มคือวางได้แต่จะมีปัญหา
          <button className="text-button" type="button" onClick={() => setHeld(null)}>ยกเลิก</button>
        </p>
      ) : null}

      <div className="matrix-scroll">
        <table className="matrix">
          <caption className="sr-only">ตารางห้องเรียนทั้งสัปดาห์ คอลัมน์เป็นห้อง แถวเป็นคาบของแต่ละวัน</caption>
          <thead>
            <tr>
              <th className="matrix-corner" scope="col">คาบ</th>
              {columns.map((column) => (
                <th className="matrix-room" key={column.key} scope="col">
                  <span className="room-swatch" style={{ background: column.accent }} aria-hidden="true" />
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => (
              <Fragment key={day}>
                <tr className="matrix-day">
                  <th colSpan={columns.length + 1} scope="colgroup">{DAY_LABELS[day]}</th>
                </tr>
                {PERIOD_KEYS.map((period) => {
                  const slotId = makeSlotId(day, period);
                  return (
                    <tr key={slotId}>
                      <th className="matrix-slot" scope="row">
                        <strong>{PERIODS[period].label}</strong>
                        <small>{PERIODS[period].start}</small>
                        <small>–{PERIODS[period].end}</small>
                      </th>
                      {columns.map((column) => {
                        const cellKey = `${slotId}:${column.key}`;
                        const blocked = column.room?.blockedSlots.find((entry) => entry.slotId === slotId);
                        const here = assignments.filter(
                          (item) => item.slotId === slotId && (item.roomId ?? ONLINE_COLUMN) === column.key,
                        );
                        return (
                          <td
                            className={`matrix-cell${blocked ? " is-blocked" : ""}${hover === cellKey ? cellState(slotId, column.key) : ""}`}
                            key={column.key}
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
                            {blocked ? (
                              <span className="matrix-blocked" title={blocked.reason}>กันไว้</span>
                            ) : null}
                            {here.map((assignment) => {
                              const course = coursesById.get(assignment.courseId);
                              if (!course) return null;
                              const isHeld = held?.kind === "assignment" && held.id === assignment.id;
                              return (
                                <div
                                  className={`matrix-chip${assignment.locked ? " is-locked" : ""}${hasBlockingConflict(assignment.id) ? " is-conflict" : ""}${isHeld ? " is-held" : ""}`}
                                  key={assignment.id}
                                  draggable={!assignment.locked}
                                  onDragStart={(event) => {
                                    const payload: Held = { kind: "assignment", id: assignment.id, courseId: course.id };
                                    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
                                    event.dataTransfer.effectAllowed = "move";
                                    setHeld(payload);
                                  }}
                                  onDragEnd={() => { setHeld(null); setHover(null); }}
                                >
                                  <span className="matrix-chip-copy">
                                    <strong>{course.title}</strong>
                                    <small>{course.provider}</small>
                                  </span>
                                  <span className="chip-actions">
                                    <button
                                      className={`chip-action${assignment.locked ? " is-on" : ""}`}
                                      type="button"
                                      aria-pressed={assignment.locked}
                                      title={assignment.locked ? "ปลดล็อกคาบนี้" : "ล็อกคาบนี้ไม่ให้ระบบย้าย"}
                                      onClick={() => onToggleLock(assignment.id)}
                                    >
                                      <span aria-hidden="true">{assignment.locked ? "🔒" : "🔓"}</span>
                                      <span className="sr-only">
                                        {assignment.locked ? `ปลดล็อก ${course.title}` : `ล็อก ${course.title}`}
                                      </span>
                                    </button>
                                    {assignment.locked ? null : (
                                      <button
                                        className={`chip-action${isHeld ? " is-on" : ""}`}
                                        type="button"
                                        aria-pressed={isHeld}
                                        title="ย้ายไปช่องอื่น"
                                        onClick={() =>
                                          setHeld(isHeld ? null : { kind: "assignment", id: assignment.id, courseId: course.id })
                                        }
                                      >
                                        <span aria-hidden="true">↔</span>
                                        <span className="sr-only">ย้าย {course.title} ไปช่องอื่น</span>
                                      </button>
                                    )}
                                    <button
                                      className="chip-action"
                                      type="button"
                                      title="เอาออกจากตาราง"
                                      onClick={() => onRemove(assignment.id)}
                                    >
                                      <span aria-hidden="true">×</span>
                                      <span className="sr-only">เอา {course.title} ออกจากตาราง</span>
                                    </button>
                                  </span>
                                </div>
                              );
                            })}
                            {heldCourse && !blocked ? (
                              <button
                                className={`matrix-drop${cellState(slotId, column.key)}`}
                                type="button"
                                onClick={() => held && drop(slotId, column.key, held)}
                              >
                                <span aria-hidden="true">วางที่นี่</span>
                                <span className="sr-only">
                                  วาง {heldCourse.title} ที่ {column.label} {slotLabel(slotId)}
                                </span>
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
