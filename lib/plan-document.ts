import { readChecklist, type CourseChecklist } from "./checklist.ts";
import { EMPTY_ROOM_EDITS, mergeRooms, type RoomEdits } from "./rooms.ts";
import { isSlotId, isTimeRange } from "./slots.ts";
import type { Assignment, PlanCourse, PlanPayload, PlanRoom } from "./plan-types.ts";

export const LEGACY_STORAGE_KEY = "nextlink.plan.v1";
// Versions 1/2 did not record a term; they were shipped for this term only.
export const LEGACY_TERM_ID = "2569-1";
export const storageKeyFor = (termId: string) => `nextlink.plan.v3.${termId}`;
export type CourseOverride = Partial<Pick<PlanCourse, "availability" | "sessionsPerWeek" | "minSeats" | "capacity" | "notes">>;
export type PlanData = {
  assignments: Assignment[];
  courseOverrides: Record<string, CourseOverride>;
  roomEdits: RoomEdits;
  checklists: Record<string, Partial<CourseChecklist>>;
};
export type PlanDocument = PlanData & {
  version: 3;
  termId: string;
  dataset: string;
  seedRevision: string;
  revision: number;
  editedAt: string | null;
};

export const emptyPlanData = (): PlanData => ({ assignments: [], courseOverrides: {}, roomEdits: EMPTY_ROOM_EDITS, checklists: {} });
export const emptyDocument = (payload: PlanPayload): PlanDocument => ({
  ...emptyPlanData(), version: 3, termId: payload.term.id, dataset: payload.dataset,
  seedRevision: payload.seedRevision, revision: 0, editedAt: null,
});

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function string(value: unknown): value is string { return typeof value === "string"; }
function count(value: unknown, min = 0, max = 10000): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function slots(value: unknown): boolean {
  return Array.isArray(value) && value.every((slot) => string(slot) && isSlotId(slot)) && new Set(value).size === value.length;
}
function blockedSlots(value: unknown): boolean {
  return Array.isArray(value) && value.every((slot) => object(slot) && string(slot.slotId) && isSlotId(slot.slotId) && string(slot.reason))
    && new Set(value.map((slot) => slot.slotId)).size === value.length;
}
function roomPatch(value: unknown, full = false): boolean {
  if (!object(value)) return false;
  if (full && (!string(value.id) || !/^[a-z0-9-]+$/.test(value.id))) return false;
  for (const key of ["name", "building", "floor"])
    if ((full || key in value) && (!string(value[key]) || !value[key].trim())) return false;
  if ((full || "seats" in value) && !count(value.seats, 1, 2000)) return false;
  if ((full || "tier" in value) && value.tier !== "READY" && value.tier !== "NEEDS_APPROVAL") return false;
  if ((full || "seatsIsEstimated" in value) && typeof value.seatsIsEstimated !== "boolean") return false;
  if ((full || "blockedSlots" in value) && !blockedSlots(value.blockedSlots)) return false;
  return Object.keys(value).every((key) => ["name", "building", "floor", "seats", "tier", "seatsIsEstimated", "blockedSlots", ...(full ? ["id"] : [])].includes(key));
}
function override(value: unknown): value is CourseOverride {
  if (!object(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (key === "availability") return slots(item);
    if (key === "sessionsPerWeek") return count(item, 1, 18);
    if (key === "minSeats" || key === "capacity") return count(item);
    return key === "notes" && (item === null || string(item));
  });
}

/** Runtime validation at the persistence boundary; no partial/unsafe casts reach React. */
export function decodePlan(raw: string, payload: PlanPayload): { document: PlanDocument; migrated: boolean } {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3)) throw new Error("ไม่รู้จักรูปแบบไฟล์แผน");
  const legacy = value.version === 1 || value.version === 2;
  if (legacy && payload.term.id !== LEGACY_TERM_ID) throw new Error("แผนรุ่นเก่าเป็นของเทอม 2569-1");
  if (!legacy && (value.termId !== payload.term.id || value.dataset !== payload.dataset)) throw new Error("ไฟล์แผนนี้เป็นของคนละเทอมหรือชุดข้อมูล");
  if (!legacy && (!count(value.revision, 0, Number.MAX_SAFE_INTEGER) || !string(value.seedRevision))) throw new Error("ข้อมูลรุ่นของแผนไม่ถูกต้อง");
  if (value.editedAt !== null && value.editedAt !== undefined && (!string(value.editedAt) || !Number.isFinite(Date.parse(value.editedAt)))) throw new Error("วันที่บันทึกแผนไม่ถูกต้อง");
  if (!Array.isArray(value.assignments)) throw new Error("รายการคาบเรียนไม่ถูกต้อง");
  const courseOverrides = value.courseOverrides ?? {};
  const edits = value.roomEdits ?? EMPTY_ROOM_EDITS;
  const checklists = value.checklists ?? {};
  if (!object(courseOverrides) || !Object.values(courseOverrides).every(override)) throw new Error("ข้อมูลแก้ไขวิชาไม่ถูกต้อง");
  if (!object(edits) || !object(edits.overrides) || !Object.values(edits.overrides).every((value) => roomPatch(value))
    || !Array.isArray(edits.added) || !edits.added.every((value) => roomPatch(value, true))
    || !Array.isArray(edits.removed) || !edits.removed.every(string)) throw new Error("ข้อมูลแก้ไขห้องไม่ถูกต้อง");
  if (!object(checklists) || !Object.values(checklists).every(object)) throw new Error("ข้อมูลเช็กลิสต์ไม่ถูกต้อง");
  const rooms = mergeRooms(payload.rooms, edits as RoomEdits);
  const roomIds = new Set(rooms.map((room) => room.id));
  if (roomIds.size !== rooms.length) throw new Error("มีรหัสห้องซ้ำในแผน");
  const courses = new Map(payload.courses.map((course) => [course.id, course]));
  const ids = new Set<string>(), sessions = new Set<string>();
  for (const item of value.assignments) {
    if (!object(item) || !string(item.id) || !item.id || !string(item.courseId) || !courses.has(item.courseId)
      || !string(item.slotId) || !isSlotId(item.slotId) || !isTimeRange(item.startTime, item.endTime)
      || typeof item.locked !== "boolean" || !["MANUAL", "AUTO"].includes(String(item.source))
      || !(item.roomId === null || (string(item.roomId) && roomIds.has(item.roomId)))) throw new Error("มีคาบที่อ้างอิงวิชา ห้อง หรือเวลาไม่ถูกต้อง");
    if (courses.get(item.courseId)?.deliveryMode === "ONLINE" && item.roomId !== null) throw new Error("คาบออนไลน์ไม่ควรใช้ห้องเรียน");
    // Legacy roomless onsite decisions remain visible with NO_ROOM_AVAILABLE;
    // commands refuse new ones, and the user can move/recover existing work.
    const session = `${item.courseId}@${item.slotId}`;
    if (ids.has(item.id) || sessions.has(session)) throw new Error("มีคาบหรือรหัสคาบซ้ำในแผน");
    ids.add(item.id); sessions.add(session);
  }
  // Removed seed references require explicit recovery rather than silently
  // throwing away work after a deployment changes the bundled facts.
  if (Object.keys(courseOverrides).some((id) => !courses.has(id)) || Object.keys(checklists).some((id) => !courses.has(id))) throw new Error("แผนมีข้อมูลของวิชาที่ไม่อยู่ในชุดข้อมูลปัจจุบัน");
  const knownRooms = new Set([...payload.rooms, ...(edits.added as PlanRoom[])].map((room) => room.id));
  if (knownRooms.size !== payload.rooms.length + edits.added.length) throw new Error("มีรหัสห้องซ้ำกับห้องเดิมในแผน");
  if (Object.keys(edits.overrides).some((id) => !knownRooms.has(id))) throw new Error("แผนอ้างอิงห้องที่ถูกนำออกจากชุดข้อมูล");
  const document: PlanDocument = {
    ...emptyDocument(payload), assignments: value.assignments as Assignment[],
    courseOverrides: courseOverrides as Record<string, CourseOverride>, roomEdits: edits as RoomEdits,
    checklists: Object.fromEntries(Object.entries(checklists).map(([id, value]) => [id, readChecklist(value as Partial<CourseChecklist>)])),
    revision: legacy ? 0 : value.revision as number,
    editedAt: string(value.editedAt) ? value.editedAt : null,
  };
  return { document, migrated: legacy || value.seedRevision !== payload.seedRevision };
}
