import type { BlockerCode } from "./plan-types.ts";

/**
 * What each rule reads like to a person.
 *
 * Both the assign dialog and the board show these, and they have to match word
 * for word — the same obstruction described two ways reads as two problems.
 */
export const BLOCKER_LABELS: Record<BlockerCode, string> = {
  OUTSIDE_AVAILABILITY: "บริษัทไม่ได้แจ้งว่าสะดวกคาบนี้",
  ROOM_BLOCKED: "ห้องถูกกันไว้คาบนี้",
  ROOM_DOUBLE_BOOKED: "ห้องถูกใช้อยู่แล้ว",
  ROOM_TOO_SMALL: "ห้องเล็กกว่าจำนวนที่รับ",
  INSTRUCTOR_BUSY: "ผู้สอนติดสอนวิชาอื่น",
  PROVIDER_BUSY: "บริษัทส่งทีมไปสอนวิชาอื่นแล้ว",
  NO_ROOM_AVAILABLE: "ไม่มีห้องรองรับ",
};
