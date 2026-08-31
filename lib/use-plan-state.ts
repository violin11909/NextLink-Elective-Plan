"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { conflictCounts, detectConflicts, type Conflict } from "@/lib/conflicts.ts";
import { defaultTimesFor, explainFailure, planSchedule, sortAssignments } from "@/lib/scheduler.ts";
import type { Assignment, FailureReason, PlanCourse, PlanPayload } from "@/lib/plan-types.ts";
import type { SlotId } from "@/lib/slots.ts";

const STORAGE_KEY = "nextlink.plan.v1";

type CourseOverride = Partial<Pick<PlanCourse, "availability" | "sessionsPerWeek" | "minSeats" | "capacity" | "notes">>;

type StoredPlan = {
  version: 1;
  assignments: Assignment[];
  courseOverrides: Record<string, CourseOverride>;
  editedAt: string;
};

export type PlanGap = { course: PlanCourse; missing: number; reason: FailureReason };

/**
 * Everything the planner pages read and write.
 *
 * Only two things are stored: the assignments, and the fields a person edited
 * on a course. Conflicts and gaps are recomputed from those on every render —
 * derived state that is also persisted is just two copies waiting to disagree,
 * and this one would disagree in the direction of showing a stale "all clear".
 */
export function usePlanState(payload: PlanPayload) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [overrides, setOverrides] = useState<Record<string, CourseOverride>>({});
  const [editedAt, setEditedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  /** One step of undo. Every mutation below snapshots into it before changing. */
  const undoRef = useRef<{ assignments: Assignment[]; overrides: Record<string, CourseOverride> } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredPlan;
        if (parsed?.version === 1 && Array.isArray(parsed.assignments)) {
          setAssignments(sortAssignments(parsed.assignments));
          setOverrides(parsed.courseOverrides ?? {});
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
      const stored: StoredPlan = { version: 1, assignments, courseOverrides: overrides, editedAt };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage full or unavailable — the in-memory plan still stands.
    }
  }, [assignments, overrides, editedAt, ready]);

  /** Courses as they are now: the bundled data with a person's edits laid over. */
  const courses = useMemo(
    () => payload.courses.map((course) => ({ ...course, ...(overrides[course.id] ?? {}) })),
    [payload.courses, overrides],
  );

  const conflicts: Conflict[] = useMemo(
    () => detectConflicts({ courses, rooms: payload.rooms, assignments }),
    [courses, payload.rooms, assignments],
  );

  const counts = useMemo(() => conflictCounts(conflicts), [conflicts]);

  /** Courses that still owe the week a period, and why they could not get one. */
  const gaps: PlanGap[] = useMemo(() => {
    const found: PlanGap[] = [];
    for (const course of courses) {
      const placed = assignments.filter((item) => item.courseId === course.id).length;
      if (placed >= course.sessionsPerWeek) continue;
      found.push({
        course,
        missing: course.sessionsPerWeek - placed,
        reason: explainFailure({ course, courses, rooms: payload.rooms, placed: assignments }),
      });
    }
    return found;
  }, [courses, assignments, payload.rooms]);

  const commit = useCallback(
    (next: { assignments?: Assignment[]; overrides?: Record<string, CourseOverride> }) => {
      undoRef.current = { assignments, overrides };
      if (next.assignments) setAssignments(sortAssignments(next.assignments));
      if (next.overrides) setOverrides(next.overrides);
      setEditedAt(new Date().toISOString());
    },
    [assignments, overrides],
  );

  const undo = useCallback(() => {
    const previous = undoRef.current;
    if (!previous) return false;
    undoRef.current = null;
    setAssignments(previous.assignments);
    setOverrides(previous.overrides);
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
    const result = planSchedule({ courses, rooms: payload.rooms, locked });
    commit({ assignments: result.assignments });
    return result;
  }, [assignments, courses, payload.rooms, commit]);

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

  const resetAll = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    undoRef.current = null;
    setAssignments([]);
    setOverrides({});
    setEditedAt(null);
  }, []);

  return {
    ready,
    courses,
    rooms: payload.rooms,
    assignments,
    conflicts,
    counts,
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
    clearUnlocked,
    resetAll,
    undo,
  };
}
