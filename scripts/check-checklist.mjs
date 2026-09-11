#!/usr/bin/env node
/**
 * Tests for the paperwork checklist in lib/checklist.ts.
 *
 * The failure mode here is quiet and expensive: a step that reads as done
 * when it is not. Nobody re-checks a green row, so every rule that decides
 * "done" is pinned below — including the ones about junk in storage, because
 * a saved plan outlives the version of the page that wrote it.
 * `node --experimental-strip-types` runs the TypeScript sources directly.
 */
import {
  CHECKLIST_FIELDS,
  DONE_LABELS,
  DONE_ORDER,
  EMPTY_CHECKLIST,
  RECEIPT_LABELS,
  RECEIPT_ORDER,
  checklistPatch,
  checklistProgress,
  checklistTone,
  checklistValueText,
  isChecklistComplete,
  isFieldDone,
  readChecklist,
} from "../lib/checklist.ts";

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

const finished = {
  invitationLetter: "RECEIVED",
  teachingHoursLetter: "RECEIVED",
  mcvInstructorRequest: "DONE",
  mentorAdded: "DONE",
  guestLecturerAdded: "DONE",
  mcvJoinCode: "CP-4821",
  studentsAdded: "DONE",
};

const field = (key) => CHECKLIST_FIELDS.find((item) => item.key === key);

check("the table asks about every field of the checklist, once each", () => {
  const keys = CHECKLIST_FIELDS.map((item) => item.key);
  if (new Set(keys).size !== keys.length) return "a field is asked about twice";
  const stored = Object.keys(EMPTY_CHECKLIST);
  const missing = stored.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !stored.includes(key));
  if (missing.length) return `stored but never shown: ${missing.join(", ")}`;
  return extra.length ? `shown but never stored: ${extra.join(", ")}` : null;
});

check("every status has a label, and no label is left blank", () => {
  const blanks = [
    ...RECEIPT_ORDER.filter((status) => !RECEIPT_LABELS[status]?.trim()),
    ...DONE_ORDER.filter((status) => !DONE_LABELS[status]?.trim()),
  ];
  if (blanks.length) return `no label for ${blanks.join(", ")}`;
  // Thai on both kinds: the two sit in adjacent columns of one row.
  const latin = [...Object.values(RECEIPT_LABELS), ...Object.values(DONE_LABELS)].filter((label) => /[A-Za-z]/.test(label));
  return latin.length === 0 ? null : `still in English: ${latin.join(", ")}`;
});

check("a course nobody has touched is 0/7 and not complete", () => {
  const progress = checklistProgress(EMPTY_CHECKLIST);
  if (progress.done !== 0 || progress.total !== 7) return `progress is ${progress.done}/${progress.total}`;
  return isChecklistComplete(EMPTY_CHECKLIST) ? "an untouched checklist counted as complete" : null;
});

check("everything answered is 7/7 and complete", () => {
  const checklist = readChecklist(finished);
  const progress = checklistProgress(checklist);
  if (progress.done !== 7) return `progress is ${progress.done}/7`;
  return isChecklistComplete(checklist) ? null : "a finished checklist did not count as complete";
});

check("\"กำลังดำเนินการ\" is not \"ได้รับแล้ว\"", () => {
  const checklist = readChecklist({ ...finished, invitationLetter: "IN_PROGRESS" });
  if (isFieldDone(checklist, field("invitationLetter"))) return "a letter still being chased counted as received";
  if (isChecklistComplete(checklist)) return "the row counted as complete";
  return checklistTone(checklist, field("invitationLetter")) === "orange" ? null : "it is not marked as in progress";
});

check("a join code counts only once it exists", () => {
  const blank = readChecklist({ ...finished, mcvJoinCode: "   " });
  if (isFieldDone(blank, field("mcvJoinCode"))) return "whitespace counted as a code";
  if (isChecklistComplete(blank)) return "a course with no join code counted as complete";
  return isFieldDone(readChecklist(finished), field("mcvJoinCode")) ? null : "a real code did not count";
});

check("junk in storage reads as not done, not as a crash", () => {
  const checklist = readChecklist({
    invitationLetter: "DONE", // a status from the other kind of field
    teachingHoursLetter: 42,
    mentorAdded: "yes",
    mcvJoinCode: null,
    studentsAdded: "DONE",
  });
  if (checklist.invitationLetter !== "NOT_RECEIVED") return `invitationLetter read as ${checklist.invitationLetter}`;
  if (checklist.teachingHoursLetter !== "NOT_RECEIVED") return "a number read as a status";
  if (checklist.mentorAdded !== "NOT_DONE") return "an unknown word read as done";
  if (checklist.mcvJoinCode !== "") return "a null code did not read as empty";
  return checklist.studentsAdded === "DONE" ? null : "a good value was thrown away with the bad ones";
});

check("a patch writes the field it was given and nothing else", () => {
  const patch = checklistPatch(field("mentorAdded"), "DONE");
  if (Object.keys(patch).join(",") !== "mentorAdded") return `patched ${Object.keys(patch).join(", ")}`;
  if (patch.mentorAdded !== "DONE") return "the value did not land";
  const code = checklistPatch(field("mcvJoinCode"), "CP-99");
  return code.mcvJoinCode === "CP-99" ? null : "the join code did not land";
});

check("a status the app does not know is refused, not stored", () => {
  const bad = checklistPatch(field("invitationLetter"), "MAYBE");
  if (bad.invitationLetter !== "NOT_RECEIVED") return `stored ${bad.invitationLetter}`;
  const wrongKind = checklistPatch(field("mentorAdded"), "RECEIVED");
  return wrongKind.mentorAdded === "NOT_DONE" ? null : `a receipt status was stored on an MCV step: ${wrongKind.mentorAdded}`;
});

check("every field can say its own answer in words", () => {
  const checklist = readChecklist({ ...finished, invitationLetter: "IN_PROGRESS" });
  const texts = CHECKLIST_FIELDS.map((item) => checklistValueText(checklist, item));
  if (texts.some((text) => typeof text !== "string")) return "a field had no text";
  if (!texts.includes("กำลังดำเนินการ")) return "the in-progress letter did not say so";
  return texts.includes("CP-4821") ? null : "the join code was not carried through";
});

if (failures) {
  console.error(`\nchecklist: ${failures} failing check(s)`);
  process.exit(1);
}
console.log("checklist: ok (10 checks)");
