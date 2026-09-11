"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectConflicts, type Conflict } from "@/lib/conflicts.ts";
import {
  EMPTY_ROOM_EDITS,
  addRoom as addRoomTo,
  deleteRoom,
  mergeRooms,
  patchRoom,
  setRoomBlocked,
  type RoomDraft,
  type RoomEdits,
  type RoomOverride,
} from "@/lib/rooms.ts";
import { defaultTimesFor, explainFailure, planSchedule, sortAssignments } from "@/lib/scheduler.ts";
import type { Assignment, FailureReason, PlanCourse, PlanPayload } from "@/lib/plan-types.ts";
import type { SlotId } from "@/lib/slots.ts";

/** The key is unchanged from the first release; `version` inside it is what moves. */
const STORAGE_KEY = "nextlink.plan.v1";

type CourseOverride = Partial<Pick<PlanCourse, "availability" | "sessionsPerWeek" | "minSeats" | "capacity" | "notes">>;

/**
 * Version 2 added the room edits. A version 1 store is read as it always was
 * and simply has no rooms in it — a saved plan is hours of someone's work, and
 * throwing it away because the schema grew is not a migration.
 */
type StoredPlan = {
  version: 1 | 2;
  assignments: Assignment[];
  courseOverrides: Record<string, CourseOverride>;
  roomEdits?: RoomEdits;
  editedAt: string;
};

export type PlanGap = { course: PlanCourse; missing: number; reason: FailureReason };

/**
 * Everything the planner pages read and write.
 *
 * Three things are stored: the assignments, the fields a person edited on a
 * course, and the rooms they added, changed or removed. Conflicts and gaps are
 * recomputed from those on every render — derived state that is also persisted
 * is just two copies waiting to disagree, and this one would disagree in the
 * direction of showing a stale "all clear".
 */
export function usePlanState(payload: PlanPayload) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [overrides, setOverrides] = useState<Record<string, CourseOverride>>({});
  const [roomEdits, setRoomEdits] = useState<RoomEdits>(EMPTY_ROOM_EDITS);
  const [editedAt, setEditedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  /** One step of undo. Every mutation below snapshots into it before changing. */
  const undoRef = useRef<{
    assignments: Assignment[];
    overrides: Record<string, CourseOverride>;
    roomEdits: RoomEdits;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredPlan;
        if ((parsed?.version === 1 || parsed?.version === 2) && Array.isArray(parsed.assignments)) {
          setAssignments(sortAssignments(parsed.assignments));
          setOverrides(parsed.courseOverrides ?? {});
          const stored = parsed.roomEdits;
          setRoomEdits(
            stored && Array.isArray(stored.added) && Array.isArray(stored.removed)
              ? { overrides: stored.overrides ?? {}, added: stored.added, removed: stored.removed }
              : EMPTY_ROOM_EDITS,
          );
          setEditedAt(parsed.editedAt ?? null);
        }
      }
    } catch {
      // A corrupt or blocked store is not a reason to show nothing; start empty.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready || !editedAt) return;
    try {
      const stored: StoredPlan = { version: 2, assignments, courseOverrides: overrides, roomEdits, editedAt };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage full or unavailable — the in-memory plan still stands.
    }
  }, [assignments, overrides, roomEdits, editedAt, ready]);

  /** Courses as they are now: the bundled data with a person's edits laid over. */
  const courses = useMemo(
    () => payload.courses.map((course) => ({ ...course, ...(overrides[course.id] ?? {}) })),
    [payload.courses, overrides],
  );

  /** Rooms as they are now — the seed, plus added, minus removed. */
  const rooms = useMemo(() => mergeRooms(payload.rooms, roomEdits), [payload.rooms, roomEdits]);

  const conflicts: Conflict[] = useMemo(
    () => detectConflicts({ courses, rooms, assignments }),
    [courses, rooms, assignments],
  );

  /** Courses that still owe the week a period, and why they could not get one. */
  const gaps: PlanGap[] = useMemo(() => {
    const found: PlanGap[] = [];
    for (const course of courses) {
      const placed = assignments.filter((item) => item.courseId === course.id).length;
      if (placed >= course.sessionsPerWeek) continue;
      found.push({
        course,
        missing: course.sessionsPerWeek - placed,
        reason: explainFailure({ course, courses, rooms, placed: assignments }),
      });
    }
    return found;
  }, [courses, assignments, rooms]);

  const commit = useCallback(
    (next: {
      assignments?: Assignment[];
      overrides?: Record<string, CourseOverride>;
      roomEdits?: RoomEdits;
    }) => {
      undoRef.current = { assignments, overrides, roomEdits };
      if (next.assignments) setAssignments(sortAssignments(next.assignments));
      if (next.overrides) setOverrides(next.overrides);
      if (next.roomEdits) setRoomEdits(next.roomEdits);
      setEditedAt(new Date().toISOString());
    },
    [assignments, overrides, roomEdits],
  );

  const undo = useCallback(() => {
    const previous = undoRef.current;
    if (!previous) return false;
    undoRef.current = null;
    setAssignments(previous.assignments);
    setOverrides(previous.overrides);
    setRoomEdits(previous.roomEdits);
    setEditedAt(new Date().toISOString());
    return true;
  }, []);

  /**
   * Plan the week, keeping every locked period exactly where it is.
   *
   * Locked assignments are handed to the scheduler as fixed input rather than
   * filtered out afterwards, so the rest of the plan is built around them
   * instead of on top of them.
   */
  const runAutoAssign = useCallback(() => {
    const locked = assignments.filter((item) => item.locked);
    const result = planSchedule({ courses, rooms, locked });
    commit({ assignments: result.assignments });
    return result;
  }, [assignments, courses, rooms, commit]);

  const place = useCallback(
    (courseId: string, slotId: SlotId, roomId: string | null) => {
      const id = `${courseId}@${slotId}`;
      if (assignments.some((item) => item.id === id)) return;
      const next: Assignment = { id, courseId, slotId, roomId, ...defaultTimesFor(slotId), locked: false, source: "MANUAL" };
      commit({ assignments: [...assignments, next] });
    },
    [assignments, commit],
  );

  const move = useCallback(
    (assignmentId: string, slotId: SlotId, roomId: string | null) => {
      const current = assignments.find((item) => item.id === assignmentId);
      if (!current) return;
      // The id encodes course and period, so a move mints a new one — otherwise
      // two periods of the same course could collide on one id.
      const moved: Assignment = {
        ...current,
        id: `${current.courseId}@${slotId}`,
        slotId,
        roomId,
        ...defaultTimesFor(slotId),
        source: "MANUAL",
      };
      commit({ assignments: [...assignments.filter((item) => item.id !== assignmentId), moved] });
    },
    [assignments, commit],
  );

  const remove = useCallback(
    (assignmentId: string) => commit({ assignments: assignments.filter((item) => item.id !== assignmentId) }),
    [assignments, commit],
  );

  const toggleLock = useCallback(
    (assignmentId: string) =>
      commit({
        assignments: assignments.map((item) => (item.id === assignmentId ? { ...item, locked: !item.locked } : item)),
      }),
    [assignments, commit],
  );

  const setTime = useCallback(
    (assignmentId: string, startTime: string, endTime: string) =>
      commit({
        assignments: assignments.map((item) => (item.id === assignmentId ? { ...item, startTime, endTime } : item)),
      }),
    [assignments, commit],
  );

  const setAvailability = useCallback(
    (courseId: string, slotIds: SlotId[]) =>
      commit({
        overrides: { ...overrides, [courseId]: { ...(overrides[courseId] ?? {}), availability: slotIds } },
      }),
    [overrides, commit],
  );

  const setCourseField = useCallback(
    (courseId: string, patch: CourseOverride) =>
      commit({ overrides: { ...overrides, [courseId]: { ...(overrides[courseId] ?? {}), ...patch } } }),
    [overrides, commit],
  );

  const clearUnlocked = useCallback(
    () => commit({ assignments: assignments.filter((item) => item.locked) }),
    [assignments, commit],
  );

  /* ---- rooms -------------------------------------------------------- */

  const addRoom = useCallback(
    (draft: RoomDraft) => {
      // Ids are checked against every room the seed has ever carried, not just
      // the visible ones: a removed room can come back with "คืนค่าเริ่มต้น",
      // and two rooms sharing an id would then be one room with two names.
      const taken = [...payload.rooms.map((room) => room.id), ...roomEdits.added.map((room) => room.id)];
      const { edits, id } = addRoomTo(roomEdits, draft, taken);
      commit({ roomEdits: edits });
      return id;
    },
    [payload.rooms, roomEdits, commit],
  );

  const updateRoom = useCallback(
    (roomId: string, patch: RoomOverride) => commit({ roomEdits: patchRoom(roomEdits, roomId, patch) }),
    [roomEdits, commit],
  );

  /**
   * Remove a room, and let go of whatever was in it.
   *
   * The classes are dropped in the same commit as the room, so one undo brings
   * back both. Leaving them behind pointing at a room that no longer exists
   * would be worse than either: the board would stop showing them while the
   * counts still counted them.
   */
  const removeRoom = useCallback(
    (roomId: string) => {
      commit({
        roomEdits: deleteRoom(roomEdits, roomId),
        assignments: assignments.filter((item) => item.roomId !== roomId),
      });
    },
    [roomEdits, assignments, commit],
  );

  /** Hold a period in a room for something that is not an elective, or let it go. */
  const setBlocked = useCallback(
    (roomId: string, slotId: SlotId, reason: string | null) => {
      const room = rooms.find((item) => item.id === roomId);
      if (!room) return;
      commit({ roomEdits: setRoomBlocked(roomEdits, room, slotId, reason) });
    },
    [rooms, roomEdits, commit],
  );

  /** How many classes sit in a room — what a delete is about to throw out. */
  const assignmentsInRoom = useCallback(
    (roomId: string) => assignments.filter((item) => item.roomId === roomId).length,
    [assignments],
  );

  const resetAll = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    undoRef.current = null;
    setAssignments([]);
    setOverrides({});
    setRoomEdits(EMPTY_ROOM_EDITS);
    setEditedAt(null);
  }, []);

  return {
    ready,
    courses,
    rooms,
    assignments,
    conflicts,
    gaps,
    editedAt,
    runAutoAssign,
    place,
    move,
    remove,
    toggleLock,
    setTime,
    setAvailability,
    setCourseField,
    addRoom,
    updateRoom,
    removeRoom,
    setBlocked,
    assignmentsInRoom,
    clearUnlocked,
    resetAll,
    undo,
  };
}
