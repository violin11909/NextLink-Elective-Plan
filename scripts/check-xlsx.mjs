#!/usr/bin/env node
/**
 * Tests for the hand-written .xlsx writer.
 *
 * Excel does not explain itself: a byte wrong in a zip header or a character
 * XML cannot carry, and the answer is "the file is corrupt" with no line
 * number. So every rule this writer has to obey is pinned here, where breaking
 * one names itself. `node --experimental-strip-types` runs the TypeScript
 * sources directly — no build step, no test framework.
 */
import { buildXlsx, crc32, columnName } from "../lib/xlsx.ts";
import { buildChecklistWorkbook, buildCourseWorkbook, courseFileName } from "../lib/course-export.ts";
import { CHECKLIST_FIELDS, readChecklist } from "../lib/checklist.ts";

let failures = 0;
const check = (name, fn) => {
  try {
    const problem = fn();
    if (problem) {
      failures += 1;
      console.error(`  ✗ ${name}\n      ${problem}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}\n      threw: ${error.message}`);
  }
};

/**
 * Read a stored (uncompressed) zip back into { name: text }.
 *
 * Deliberately not a general unzip: it walks the local headers the writer
 * emits, so a header the writer gets wrong is a header this cannot read.
 */
const readZip = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const parts = new Map();
  let at = 0;
  while (at + 4 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    if (method !== 0) throw new Error(`entry at ${at} is compressed (method ${method})`);
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const start = at + 30 + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`${name}: stored CRC does not match its bytes`);
    parts.set(name, decoder.decode(data));
    at = start + size;
  }
  return parts;
};

const MODIFIED = new Date("2026-09-07T10:00:00+07:00");

const sample = () =>
  buildXlsx(
    [
      {
        name: "รายวิชา 1/2569",
        columns: [
          { header: "ชื่อ", width: 20 },
          { header: "รับได้", width: 10 },
          { header: "หมายเหตุ", width: 30, wrap: true },
        ],
        rows: [
          ["R&D <lab>", 42, "บรรทัด\u0007เดียว"],
          ["ว่าง", null, ""],
        ],
        filter: true,
      },
    ],
    { modified: MODIFIED },
  );

check("CRC32 matches the standard check value", () => {
  const value = crc32(new TextEncoder().encode("123456789"));
  return value === 0xcbf43926 ? null : `got 0x${value.toString(16)}, expected 0xcbf43926`;
});

check("column letters carry past Z", () => {
  const got = [0, 25, 26, 27, 51, 52].map(columnName).join(",");
  return got === "A,Z,AA,AB,AZ,BA" ? null : `got ${got}`;
});

check("the file is a zip with every part Excel opens first", () => {
  const parts = readZip(sample());
  const required = [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
  ];
  const missing = required.filter((name) => !parts.has(name));
  return missing.length ? `missing ${missing.join(", ")}` : null;
});

check("the central directory agrees with the entries", () => {
  const bytes = sample();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) return "no end-of-central-directory record at the tail";
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (offset + size !== end) return `directory at ${offset}+${size} does not end where the EOCD begins (${end})`;
  if (count !== readZip(bytes).size) return `EOCD counts ${count} entries, the stream holds ${readZip(bytes).size}`;
  // Every central header must point at a real local header.
  let at = offset;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) return `central header ${index} has the wrong signature`;
    const local = view.getUint32(at + 42, true);
    if (view.getUint32(local, true) !== 0x04034b50) return `central header ${index} points at ${local}, not a local header`;
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return at === end ? null : `walked the directory to ${at}, expected ${end}`;
});

check("text is XML-escaped and illegal control characters are dropped", () => {
  const sheet = readZip(sample()).get("xl/worksheets/sheet1.xml");
  if (!sheet.includes("R&amp;D &lt;lab&gt;")) return "ampersand or angle bracket reached the XML unescaped";
  if (sheet.includes("\u0007")) return "a control character XML cannot carry is still in the file";
  if (!sheet.includes("บรรทัดเดียว")) return "dropping the control character took the surrounding text with it";
  return null;
});

check("numbers are numeric cells and blanks are empty ones", () => {
  const sheet = readZip(sample()).get("xl/worksheets/sheet1.xml");
  if (!sheet.includes("<v>42</v>")) return "42 was not written as a number";
  if (sheet.includes(">42<") && sheet.includes("<is><t")) {
    const inline = sheet.match(/<is><t[^>]*>42</);
    if (inline) return "42 was written as text as well";
  }
  if (!/<c r="B3"[^>]*\/>/.test(sheet)) return "the blank cell is not an empty cell";
  return null;
});

check("the header row is frozen and filterable", () => {
  const sheet = readZip(sample()).get("xl/worksheets/sheet1.xml");
  if (!sheet.includes('state="frozen"')) return "the header row is not frozen";
  if (!sheet.includes('<autoFilter ref="A1:C3"/>')) return "the autofilter is missing or covers the wrong range";
  if (sheet.indexOf("<autoFilter") < sheet.indexOf("</sheetData>")) return "autoFilter must follow sheetData";
  return null;
});

check("a sheet name Excel would reject is cleaned, not passed through", () => {
  const workbook = readZip(
    buildXlsx([{ name: "ภาคปลาย 2/2568 [เก่า]", columns: [{ header: "ก", width: 5 }], rows: [] }], {
      modified: MODIFIED,
    }),
  ).get("xl/workbook.xml");
  if (/name="[^"]*[\\/?*[\]:]/.test(workbook)) return `a forbidden character survived: ${workbook}`;
  const name = workbook.match(/name="([^"]*)"/)[1];
  return name.length <= 31 ? null : `sheet name is ${name.length} characters`;
});

check("the same input twice gives the identical file", () => {
  const first = sample();
  const second = sample();
  if (first.length !== second.length) return `${first.length} vs ${second.length} bytes`;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return `byte ${index} differs`;
  }
  return null;
});

/* ---- the course export itself ---------------------------------------- */

const course = (over = {}) => ({
  id: over.id ?? "c1",
  courseCode: over.courseCode ?? "21105801",
  title: over.title ?? "SW Dev",
  category: "วิศวกรรมซอฟต์แวร์",
  provider: "Soft Square",
  instructor: "อาจารย์กานต์",
  coordinator: over.coordinator ?? { name: "คุณนลิน", email: "narin@example.com", lineId: "mock_line" },
  deliveryMode: over.deliveryMode ?? "ON_SITE",
  availability: over.availability ?? ["WED_AM", "FRI_AM"],
  sessionsPerWeek: over.sessionsPerWeek ?? 1,
  minSeats: 40,
  capacity: 40,
  weeks: 10,
  notes: over.notes ?? null,
});

const term = (status) => ({
  id: "2568-2",
  academicYear: 2568,
  season: "SECOND",
  label: "ภาคปลาย ปีการศึกษา 2568",
  shortLabel: "2/2568",
  status,
});

const context = (over = {}) => ({
  term: term(over.isArchived ? "ARCHIVED" : "CURRENT"),
  isArchived: over.isArchived ?? false,
  filters: over.filters ?? [],
  dataUpdated: "2026-05-15T09:00:00+07:00",
  isMock: over.isMock ?? true,
  timezone: "Asia/Bangkok",
  exportedAt: MODIFIED,
});

const placed = [{ key: "k1", slotId: "WED_AM", roomLabel: "จุฬาพัฒน์ 4 ชั้น 1", locked: false }];

check("every row has exactly as many cells as the sheet has headers", () => {
  for (const isArchived of [false, true]) {
    const parts = readZip(
      buildCourseWorkbook(context({ isArchived }), [
        { course: course(), placed },
        { course: course({ id: "c2", deliveryMode: "ONLINE", sessionsPerWeek: 2 }), placed: [] },
      ]),
    );
    const sheet = parts.get("xl/worksheets/sheet1.xml");
    const rows = [...sheet.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map((m) => (m[1].match(/<c /g) || []).length);
    if (new Set(rows).size !== 1) return `${isArchived ? "archive" : "current"}: rows have ${rows.join("/")} cells`;
  }
  return null;
});

check("a finished term drops the columns it has no answer for", () => {
  const rows = [{ course: course(), placed }];
  const current = readZip(buildCourseWorkbook(context(), rows)).get("xl/worksheets/sheet1.xml");
  const archived = readZip(buildCourseWorkbook(context({ isArchived: true }), rows)).get("xl/worksheets/sheet1.xml");
  if (!current.includes("สถานะการจัด") || !current.includes("ผู้ประสานงาน")) {
    return "the current term lost a column it should carry";
  }
  if (archived.includes("สถานะการจัด")) return "a finished term still offers a placement status";
  if (archived.includes("ผู้ประสานงาน")) return "a finished term still carries a coordinator to call";
  if (!archived.includes("ช่วงที่แจ้งไว้")) return "a finished term should say the periods were what was offered then";
  return null;
});

check("an unplaced course is reported as unplaced, not as blank", () => {
  const sheet = readZip(
    buildCourseWorkbook(context(), [{ course: course({ sessionsPerWeek: 2 }), placed }]),
  ).get("xl/worksheets/sheet1.xml");
  return sheet.includes("ยังขาด 1 คาบ") ? null : "a course short of a period does not say so";
});

check("the export carries where it came from, mock warning included", () => {
  const parts = readZip(buildCourseWorkbook(context({ filters: ["ค้นหา: cloud"] }), [{ course: course(), placed }]));
  const about = parts.get("xl/worksheets/sheet2.xml");
  if (!about) return "there is no second sheet";
  for (const needed of ["ภาคปลาย ปีการศึกษา 2568", "ค้นหา: cloud", "ข้อมูลตัวอย่าง"]) {
    if (!about.includes(needed)) return `the sheet does not mention "${needed}"`;
  }
  return null;
});

check("the file name is ASCII, dated, and names its term", () => {
  const name = courseFileName(context());
  if (!/^[\x20-\x7e]+$/.test(name)) return `not ASCII: ${name}`;
  return name === "nextlink-courses-2568-2-20260907.xlsx" ? null : `got ${name}`;
});

/* ---- the checklist export -------------------------------------------- */

check("the checklist sheet asks every step, and says whether the row is done", () => {
  const rows = [
    { course: course(), checklist: readChecklist({ invitationLetter: "RECEIVED", mcvJoinCode: "CP-4821" }) },
    {
      course: course({ id: "c2", courseCode: "21105802", title: "AI Service" }),
      checklist: readChecklist({
        invitationLetter: "RECEIVED",
        teachingHoursLetter: "RECEIVED",
        mcvInstructorRequest: "DONE",
        mentorAdded: "DONE",
        guestLecturerAdded: "DONE",
        mcvJoinCode: "CP-1234",
        studentsAdded: "DONE",
      }),
    },
  ];
  const parts = readZip(buildChecklistWorkbook(context(), rows));
  const sheet = parts.get("xl/worksheets/sheet1.xml");
  const missing = CHECKLIST_FIELDS.filter((item) => !sheet.includes(item.label));
  if (missing.length) return `no column for ${missing.map((item) => item.label).join(", ")}`;
  if (!sheet.includes("ยังไม่ครบ (2/7)")) return "an unfinished row does not say how far along it is";
  if (!sheet.includes("ครบแล้ว")) return "a finished row does not say so";
  if (!sheet.includes("CP-4821")) return "the join code is missing";
  const about = parts.get("xl/worksheets/sheet2.xml");
  return about.includes("เช็กลิสต์งานเอกสาร") ? null : "the second sheet does not say which view this was";
});

check("the two views produce two differently named files", () => {
  const table = courseFileName(context(), "table");
  const checklist = courseFileName(context(), "checklist");
  if (table === checklist) return "both views would overwrite one file";
  return checklist === "nextlink-checklist-2568-2-20260907.xlsx" ? null : `got ${checklist}`;
});

if (failures) {
  console.error(`\nxlsx: ${failures} failing check(s)`);
  process.exit(1);
}
console.log("xlsx: ok (16 checks)");
