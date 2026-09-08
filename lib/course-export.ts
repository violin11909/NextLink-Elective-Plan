import { formatUpdated } from "./format.ts";
import { slotLabel } from "./slots.ts";
import type { PlacedPeriod, PlanCourse, TermMeta } from "./plan-types.ts";
import { buildXlsx, type CellValue, type Sheet } from "./xlsx.ts";

/**
 * The course list, as a spreadsheet.
 *
 * Kept out of the component because what belongs in the file is a question
 * about the data, not about the table: the export carries fields the table has
 * no room for (weeks, minimum seats, the coordinator's contact) and leaves out
 * everything the table draws rather than states — the day colours, the lock
 * glyph, the paging.
 *
 * It exports *what the reader is looking at*: the rows that survived the
 * filters, in the order they are on screen, for the term selected. A file that
 * quietly held more rows than the page it came from would be the more
 * surprising of the two, and the filters are how anyone gets a useful subset.
 */

const MODE_LABELS: Record<PlanCourse["deliveryMode"], string> = {
  ON_SITE: "ในห้องเรียน",
  HYBRID: "ไฮบริด",
  ONLINE: "ออนไลน์",
};

export type ExportRow = { course: PlanCourse; placed: PlacedPeriod[] };

export type ExportContext = {
  term: TermMeta;
  /** A finished term: no coordinator, no "still to place" status. */
  isArchived: boolean;
  /** The active filters, already worded for a reader; empty when none. */
  filters: string[];
  /** `lastUpdated` of the data the rows came from. */
  dataUpdated: string;
  isMock: boolean;
  timezone: string;
  exportedAt: Date;
};

function contactText(course: PlanCourse): string {
  const contact = course.coordinator;
  if (!contact) return "";
  return [contact.name, contact.email, contact.lineId ? `LINE ${contact.lineId}` : ""].filter(Boolean).join(" · ");
}

function statusText(course: PlanCourse, placed: PlacedPeriod[]): string {
  const missing = course.sessionsPerWeek - placed.length;
  if (missing <= 0) return "จัดครบแล้ว";
  return placed.length === 0 ? "ยังไม่ได้จัด" : `ยังขาด ${missing} คาบ`;
}

function roomText(course: PlanCourse, placed: PlacedPeriod[]): string {
  if (course.deliveryMode === "ONLINE") return "ออนไลน์";
  const rooms = placed.map((period) => period.roomLabel ?? "ออนไลน์");
  return rooms.join(", ");
}

function courseSheet(context: ExportContext, rows: ExportRow[]): Sheet {
  const columns = [
    { header: "รหัสวิชา", width: 12 },
    { header: "ชื่อวิชา", width: 38 },
    { header: "หมวด", width: 22 },
    { header: "บริษัท", width: 18 },
    { header: "ผู้สอน", width: 24 },
    { header: "รูปแบบการสอน", width: 14 },
    { header: context.isArchived ? "ช่วงที่แจ้งไว้" : "ช่วงที่สะดวก", width: 30, wrap: true },
    { header: context.isArchived ? "คาบที่สอน" : "คาบที่ได้", width: 22, wrap: true },
    { header: "ห้อง", width: 26, wrap: true },
    ...(context.isArchived ? [] : [{ header: "สถานะการจัด", width: 14 }]),
    { header: "คาบ/สัปดาห์", width: 11 },
    { header: "ที่นั่งขั้นต่ำ", width: 11 },
    { header: "รับได้ (คน)", width: 11 },
    { header: "จำนวนสัปดาห์", width: 12 },
    ...(context.isArchived ? [] : [{ header: "ผู้ประสานงาน", width: 34, wrap: true }]),
    { header: "หมายเหตุ", width: 46, wrap: true },
  ];

  const body: CellValue[][] = rows.map(({ course, placed }) => [
    course.courseCode,
    course.title,
    course.category,
    course.provider,
    course.instructor,
    MODE_LABELS[course.deliveryMode],
    course.availability.map(slotLabel).join(", "),
    placed.map((period) => slotLabel(period.slotId)).join(", "),
    roomText(course, placed),
    ...(context.isArchived ? [] : [statusText(course, placed)]),
    course.sessionsPerWeek,
    course.minSeats,
    course.capacity,
    course.weeks,
    ...(context.isArchived ? [] : [contactText(course)]),
    course.notes ?? "",
  ]);

  return { name: context.term.label.replace("ปีการศึกษา ", ""), columns, rows: body, filter: true };
}

/**
 * A second sheet saying where the numbers came from.
 *
 * This could have been three lines above the table, but anything above the
 * header row breaks sorting and filtering for whoever opens the file — and the
 * one thing this file must never do is lose the sentence "ข้อมูลตัวอย่าง" on
 * its way into someone's email.
 */
function aboutSheet(context: ExportContext, rowCount: number): Sheet {
  const rows: CellValue[][] = [
    ["เทอม / ปีการศึกษา", context.term.label],
    ["สถานะเทอม", context.isArchived ? "ปิดแล้ว — บันทึกย้อนหลัง แก้ไขไม่ได้" : "กำลังจัดตาราง"],
    ["จำนวนวิชาในไฟล์", rowCount],
    ["ตัวกรองที่ใช้", context.filters.length ? context.filters.join(" · ") : "ไม่ได้กรอง — ทั้งเทอม"],
    ["ข้อมูลอัปเดตเมื่อ", formatUpdated(context.dataUpdated, context.timezone)],
    ["ส่งออกเมื่อ", formatUpdated(context.exportedAt.toISOString(), context.timezone)],
    ["แหล่งข้อมูล", context.isMock ? "ข้อมูลตัวอย่าง (mock) ไม่ใช่ข้อมูลจริง" : "ข้อมูลจริงจากระบบ"],
    ["ที่มา", "NextLink · หน้ารายวิชาเลือก"],
  ];
  return {
    name: "ข้อมูลการส่งออก",
    columns: [
      { header: "รายการ", width: 22 },
      { header: "ค่า", width: 62, wrap: true },
    ],
    rows,
  };
}

export function buildCourseWorkbook(context: ExportContext, rows: ExportRow[]): Uint8Array<ArrayBuffer> {
  return buildXlsx([courseSheet(context, rows), aboutSheet(context, rows.length)], {
    modified: context.exportedAt,
  });
}

/**
 * ASCII only, and the term id in the middle: these files are mailed around and
 * end up side by side in someone's Downloads folder, where a Thai filename can
 * arrive mangled and two files called "รายวิชา.xlsx" are indistinguishable.
 */
export function courseFileName(context: ExportContext): string {
  const stamp = context.exportedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `nextlink-courses-${context.term.id}-${stamp}.xlsx`;
}
