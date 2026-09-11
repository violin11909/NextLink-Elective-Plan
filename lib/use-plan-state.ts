"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { readChecklist, type CourseChecklist } from "./checklist.ts";
import { detectConflicts } from "./conflicts.ts";
import { addRoom as addRoomTo, deleteRoom, mergeRooms, patchRoom, setRoomBlocked, validateRoomDraft, type RoomDraft, type RoomOverride } from "./rooms.ts";
import { explainFailure, sortAssignments } from "./scheduler.ts";
import { scheduleInWorker } from "./schedule-worker-client.ts";
import { changeAssignmentTime, moveAssignment, placeAssignment } from "./assignments.ts";
import { decodePlan, emptyPlanData, type CourseOverride, type PlanDocument } from "./plan-document.ts";
import { browserPersistence, PlanStore } from "./plan-store.ts";
import type { FailureReason, PlanCourse, PlanPayload, ScheduleResult } from "./plan-types.ts";
import type { SlotId } from "./slots.ts";

export type PlanGap = { course: PlanCourse; missing: number; reason: FailureReason };
const PlanContext = createContext<ReturnType<typeof useController> | null>(null);

function effective(payload: PlanPayload, document: PlanDocument) {
  return {
    courses: payload.courses.map((course) => ({ ...course, ...(document.courseOverrides[course.id] ?? {}) })),
    rooms: mergeRooms(payload.rooms, document.roomEdits),
    assignments: document.assignments,
  };
}

/** Commands receive the newest document under a cross-tab lock, not a render's stale copy. */
function useController(payload: PlanPayload) {
  const planningAbort = useRef<AbortController | null>(null);
  const [planning, setPlanning] = useState(false);
  const [store] = useState(() => new PlanStore(payload, browserPersistence()));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.load();
    const onStorage = (event: StorageEvent) => { if (event.key === store.key || event.key === null) store.refresh(); };
    const onFocus = () => store.refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", onFocus); };
  }, [store]);

  const { document } = snapshot;
  const { courses, rooms, assignments } = useMemo(() => effective(payload, document), [payload, document]);
  const conflicts = useMemo(() => detectConflicts({ courses, rooms, assignments }), [courses, rooms, assignments]);
  const gaps = useMemo(() => courses.flatMap((course): PlanGap[] => {
    const missing = course.sessionsPerWeek - assignments.filter((item) => item.courseId === course.id).length;
    return missing > 0 ? [{ course, missing, reason: explainFailure({ course, courses, rooms, placed: assignments }) }] : [];
  }), [courses, rooms, assignments]);

  const commands = useMemo(() => ({
    runAutoAssign: async (): Promise<ScheduleResult | null> => {
      if (planningAbort.current) return null;
      const controller = new AbortController();
      planningAbort.current = controller;
      setPlanning(true);
      let result: ScheduleResult | null = null;
      try {
        const saved = await store.mutate(async (current) => {
          const input = effective(payload, current);
          result = await scheduleInWorker({ ...input, locked: input.assignments.filter((item) => item.locked) }, controller.signal);
          return { ...current, assignments: result.assignments };
        });
        return saved ? result : null;
      } finally { planningAbort.current = null; setPlanning(false); }
    },
    cancelPlanning: () => planningAbort.current?.abort(),
    place: (courseId: string, slotId: SlotId, roomId: string | null) => store.mutate((current) => ({
      ...current, assignments: sortAssignments(placeAssignment({ ...effective(payload, current), courseId, slotId, roomId })),
    })),
    move: (assignmentId: string, slotId: SlotId, roomId: string | null) => store.mutate((current) => ({
      ...current, assignments: sortAssignments(moveAssignment({ ...effective(payload, current), assignmentId, slotId, roomId })),
    })),
    remove: (assignmentId: string) => store.mutate((current) => ({ ...current, assignments: current.assignments.filter((item) => item.id !== assignmentId) })),
    toggleLock: (assignmentId: string) => store.mutate((current) => ({ ...current, assignments: current.assignments.map((item) => item.id === assignmentId ? { ...item, locked: !item.locked } : item) })),
    unlockCourse: (courseId: string) => store.mutate((current) => ({ ...current, assignments: current.assignments.map((item) => item.courseId === courseId ? { ...item, locked: false } : item) })),
    setTime: (id: string, start: string, end: string) => store.mutate((current) => ({ ...current, assignments: changeAssignmentTime(current.assignments, id, start, end) })),
    setAvailability: (courseId: string, availability: SlotId[]) => store.mutate((current) => ({ ...current, courseOverrides: { ...current.courseOverrides, [courseId]: { ...current.courseOverrides[courseId], availability } } })),
    toggleAvailability: (courseId: string, slotId: SlotId) => store.mutate((current) => {
      const course = effective(payload, current).courses.find((item) => item.id === courseId);
      if (!course) throw new Error("ไม่พบวิชา");
      const availability = course.availability.includes(slotId) ? course.availability.filter((slot) => slot !== slotId) : [...course.availability, slotId];
      return { ...current, courseOverrides: { ...current.courseOverrides, [courseId]: { ...current.courseOverrides[courseId], availability } } };
    }),
    setCourseField: (courseId: string, patch: CourseOverride) => store.mutate((current) => ({ ...current, courseOverrides: { ...current.courseOverrides, [courseId]: { ...current.courseOverrides[courseId], ...patch } } })),
    clearUnlocked: () => store.mutate((current) => ({ ...current, assignments: current.assignments.filter((item) => item.locked) })),
    addRoom: (draft: RoomDraft) => store.mutate((current) => {
      const { rooms } = effective(payload, current);
      const error = validateRoomDraft(draft, rooms);
      if (error) throw new Error(error);
      const taken = [...payload.rooms, ...current.roomEdits.added].map((room) => room.id);
      return { ...current, roomEdits: addRoomTo(current.roomEdits, draft, taken).edits };
    }),
    updateRoom: (id: string, patch: RoomOverride) => store.mutate((current) => {
      const { rooms } = effective(payload, current);
      const room = rooms.find((room) => room.id === id);
      if (!room) throw new Error("ไม่พบห้องนี้แล้ว กรุณาโหลดแผนล่าสุด");
      const error = validateRoomDraft({ ...room, ...patch }, rooms, id);
      if (error) throw new Error(error);
      return { ...current, roomEdits: patchRoom(current.roomEdits, id, patch) };
    }),
    removeRoom: (id: string) => store.mutate((current) => ({ ...current, roomEdits: deleteRoom(current.roomEdits, id), assignments: current.assignments.filter((item) => item.roomId !== id) })),
    setBlocked: (id: string, slotId: SlotId, reason: string | null) => store.mutate((current) => {
      const room = effective(payload, current).rooms.find((item) => item.id === id);
      if (!room) throw new Error("ไม่พบห้องนี้แล้ว");
      return { ...current, roomEdits: setRoomBlocked(current.roomEdits, room, slotId, reason) };
    }),
    setChecklistField: (id: string, patch: Partial<CourseChecklist>) => store.mutate((current) => ({ ...current, checklists: { ...current.checklists, [id]: { ...current.checklists[id], ...patch } } })),
    resetAll: () => store.replace(emptyPlanData(), store.getSnapshot().document.revision),
    importPlan: async (raw: string) => {
      try { return await store.replace(decodePlan(raw, payload).document, store.getSnapshot().document.revision); }
      catch (error) { store.reportError(error instanceof Error ? error.message : "นำเข้าไม่สำเร็จ"); return false; }
    },
  }), [store, payload]);

  return {
    ...commands, ...snapshot, planning, courses, rooms, assignments, conflicts, gaps, editedAt: document.editedAt,
    undo: store.undo, retry: store.retry, reload: store.reload, recoverEmpty: store.recoverEmpty,
    checklistFor: (id: string) => readChecklist(document.checklists[id]),
    assignmentsInRoom: (id: string) => assignments.filter((item) => item.roomId === id).length,
  };
}

export function PlanProvider({ payload, children }: { payload: PlanPayload; children: ReactNode }) {
  const value = useController(payload);
  return createElement(PlanContext.Provider, { value }, children);
}

export function usePlanState(_payload?: PlanPayload) {
  const value = useContext(PlanContext);
  if (!value) throw new Error("Planner requires PlanProvider");
  return value;
}
