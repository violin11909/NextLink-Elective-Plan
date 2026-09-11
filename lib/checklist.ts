/**
 * The paperwork behind one elective, as the staff actually track it.
 *
 * Scheduling a course is only half the job: someone still has to send the
 * invitation letter, get the teaching hours confirmed, and get four different
 * people into MCV before the first week. That list lived in a spreadsheet
 * beside this app, which is how a course ends up scheduled and still without
 * a lecturer who can open the course page.
 *
 * Two shapes of answer, because the questions are two kinds. A letter is
 * *waited for* — it has an in-between state where it has been asked for and
 * has not come back. An MCV action is done by the staff themselves: it is done
 * or it is not, and an "in progress" would only ever mean "I have the tab
 * open".
 */

export type ReceiptStatus = "NOT_RECEIVED" | "IN_PROGRESS" | "RECEIVED";
export type DoneStatus = "NOT_DONE" | "DONE";

export type CourseChecklist = {
  /** จดหมายเชิญ */
  invitationLetter: ReceiptStatus;
  /** จดหมายและแจ้งจำนวนชั่วโมงสอน */
  teachingHoursLetter: ReceiptStatus;
  /** แจ้งให้ อ. พิเศษ ขอสิทธิ์เป็น instructor กับ MCV */
  mcvInstructorRequest: DoneStatus;
  /** ดึงอาจารย์พี่เลี้ยง */
  mentorAdded: DoneStatus;
  /** ดึงอาจารย์พิเศษเข้า */
  guestLecturerAdded: DoneStatus;
  /** รหัส Join MCV สำหรับนิสิต */
  mcvJoinCode: string;
  /** ดึงนิสิตเข้า MCV */
  studentsAdded: DoneStatus;
};

export const RECEIPT_LABELS: Record<ReceiptStatus, string> = {
  NOT_RECEIVED: "ยังไม่ได้รับ",
  IN_PROGRESS: "กำลังดำเนินการ",
  RECEIVED: "ได้รับแล้ว",
};

/**
 * Thai on both kinds of answer. The staff wrote this list with the MCV steps
 * in English ("Finished / Unfinished") because that is what MCV says, but the
 * two kinds sit in adjacent columns of one row — and a row that switches
 * language halfway reads as two different systems bolted together.
 */
export const DONE_LABELS: Record<DoneStatus, string> = {
  NOT_DONE: "ยังไม่เสร็จ",
  DONE: "เสร็จแล้ว",
};

export const RECEIPT_ORDER: ReceiptStatus[] = ["NOT_RECEIVED", "IN_PROGRESS", "RECEIVED"];
export const DONE_ORDER: DoneStatus[] = ["NOT_DONE", "DONE"];

export type ChecklistField =
  | { key: "invitationLetter" | "teachingHoursLetter"; kind: "receipt"; label: string; short: string }
  | { key: "mcvInstructorRequest" | "mentorAdded" | "guestLecturerAdded" | "studentsAdded"; kind: "done"; label: string; short: string }
  | { key: "mcvJoinCode"; kind: "code"; label: string; short: string };

/**
 * The list, in the order the work happens: the letters go out first, then the
 * people are added to MCV, and the students come last because the join code
 * has to exist before anyone can be given it.
 *
 * `short` is the column header — a table with seven of these has room for a
 * phrase, not a sentence; `label` is what a screen reader and the export get.
 */
export const CHECKLIST_FIELDS: ChecklistField[] = [
  { key: "invitationLetter", kind: "receipt", label: "ทำจดหมายเชิญ", short: "จดหมายเชิญ" },
  {
    key: "teachingHoursLetter",
    kind: "receipt",
    label: "ทำจดหมายและแจ้งจำนวนชั่วโมงสอน",
    short: "จดหมาย + ชั่วโมงสอน",
  },
  {
    key: "mcvInstructorRequest",
    kind: "done",
    label: "แจ้งให้ อ. พิเศษ ขอสิทธิ์เป็น instructor กับ MCV",
    short: "ขอสิทธิ์ instructor",
  },
  { key: "mentorAdded", kind: "done", label: "ดึงอาจารย์พี่เลี้ยง", short: "อาจารย์พี่เลี้ยง" },
  { key: "guestLecturerAdded", kind: "done", label: "ดึงอาจารย์พิเศษเข้า", short: "ดึง อ. พิเศษ เข้า" },
  { key: "mcvJoinCode", kind: "code", label: "รหัส Join MCV สำหรับนิสิต", short: "รหัส Join MCV" },
  { key: "studentsAdded", kind: "done", label: "ดึงนิสิตเข้า MCV", short: "ดึงนิสิตเข้า MCV" },
];

/** Nothing done yet — what every course starts as, and what is never stored. */
export const EMPTY_CHECKLIST: CourseChecklist = {
  invitationLetter: "NOT_RECEIVED",
  teachingHoursLetter: "NOT_RECEIVED",
  mcvInstructorRequest: "NOT_DONE",
  mentorAdded: "NOT_DONE",
  guestLecturerAdded: "NOT_DONE",
  mcvJoinCode: "",
  studentsAdded: "NOT_DONE",
};

/**
 * Read one course's checklist out of storage.
 *
 * Stored values are partial on purpose: only what someone actually touched is
 * written, so a store carries the work that was done rather than a copy of the
 * blank form for every course. Anything missing, unknown or of the wrong type
 * reads as "not done" — the safe direction, because the cost of showing an
 * undone step as done is someone not doing it.
 */
export function readChecklist(stored: Partial<CourseChecklist> | undefined): CourseChecklist {
  if (!stored) return EMPTY_CHECKLIST;
  const receipt = (value: unknown, fallback: ReceiptStatus): ReceiptStatus =>
    typeof value === "string" && (RECEIPT_ORDER as string[]).includes(value) ? (value as ReceiptStatus) : fallback;
  const done = (value: unknown): DoneStatus => (value === "DONE" ? "DONE" : "NOT_DONE");
  return {
    invitationLetter: receipt(stored.invitationLetter, "NOT_RECEIVED"),
    teachingHoursLetter: receipt(stored.teachingHoursLetter, "NOT_RECEIVED"),
    mcvInstructorRequest: done(stored.mcvInstructorRequest),
    mentorAdded: done(stored.mentorAdded),
    guestLecturerAdded: done(stored.guestLecturerAdded),
    mcvJoinCode: typeof stored.mcvJoinCode === "string" ? stored.mcvJoinCode : "",
    studentsAdded: done(stored.studentsAdded),
  };
}

/** One field's answer as text — for the export and for a screen reader. */
export function checklistValueText(checklist: CourseChecklist, field: ChecklistField): string {
  if (field.kind === "receipt") return RECEIPT_LABELS[checklist[field.key]];
  if (field.kind === "done") return DONE_LABELS[checklist[field.key]];
  return checklist.mcvJoinCode;
}

/** Is this step finished? A join code counts as done once it exists. */
export function isFieldDone(checklist: CourseChecklist, field: ChecklistField): boolean {
  if (field.kind === "receipt") return checklist[field.key] === "RECEIVED";
  if (field.kind === "done") return checklist[field.key] === "DONE";
  return checklist.mcvJoinCode.trim().length > 0;
}

/** How much of the paperwork is finished, out of all seven steps. */
export function checklistProgress(checklist: CourseChecklist): { done: number; total: number } {
  return {
    done: CHECKLIST_FIELDS.filter((field) => isFieldDone(checklist, field)).length,
    total: CHECKLIST_FIELDS.length,
  };
}

export function isChecklistComplete(checklist: CourseChecklist): boolean {
  return CHECKLIST_FIELDS.every((field) => isFieldDone(checklist, field));
}

/**
 * One answer, as a patch to store.
 *
 * Written out field by field rather than as a computed key, because a
 * computed key types the patch as "some string to some status" — which is
 * exactly the shape that lets a typo write `invitationLetter: "DONE"` and
 * have it read back as "not received" forever. The values are checked too:
 * they come from this app's own controls today, but a stored plan outlives
 * the version of the page that wrote it.
 */
export function checklistPatch(field: ChecklistField, value: string): Partial<CourseChecklist> {
  const receipt = (RECEIPT_ORDER as string[]).includes(value) ? (value as ReceiptStatus) : "NOT_RECEIVED";
  const done = (DONE_ORDER as string[]).includes(value) ? (value as DoneStatus) : "NOT_DONE";
  switch (field.key) {
    case "invitationLetter":
      return { invitationLetter: receipt };
    case "teachingHoursLetter":
      return { teachingHoursLetter: receipt };
    case "mcvInstructorRequest":
      return { mcvInstructorRequest: done };
    case "mentorAdded":
      return { mentorAdded: done };
    case "guestLecturerAdded":
      return { guestLecturerAdded: done };
    case "studentsAdded":
      return { studentsAdded: done };
    case "mcvJoinCode":
      return { mcvJoinCode: value };
  }
}

/** The colour a cell wears: green when finished, amber while it is moving. */
export function checklistTone(checklist: CourseChecklist, field: ChecklistField): "green" | "orange" | "neutral" {
  if (isFieldDone(checklist, field)) return "green";
  if (field.kind === "receipt" && checklist[field.key] === "IN_PROGRESS") return "orange";
  return "neutral";
}
