/**
 * The vocabulary of the timetable: six days, three periods, and the arithmetic
 * for the real clock times inside them.
 *
 * The unit is a *period*, not a time range, because that is how the companies
 * talk: they offer "Wednesday morning", never "09:00–12:00". Keeping the offer
 * and the grid in the same unit means matching one against the other is an
 * array lookup rather than a parse, and the day a company adds a second option
 * it is one more string in a list.
 *
 * Real clock times still exist — see `Assignment.startTime` — but they are a
 * detail *inside* a period, used only for conflict checks.
 */

export type DayKey = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
export type PeriodKey = "AM" | "PM" | "EVE";
export type SlotId = `${DayKey}_${PeriodKey}`;

export const DAYS: DayKey[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const PERIOD_KEYS: PeriodKey[] = ["AM", "PM", "EVE"];

export const DAY_LABELS: Record<DayKey, string> = {
  MON: "จันทร์",
  TUE: "อังคาร",
  WED: "พุธ",
  THU: "พฤหัสบดี",
  FRI: "ศุกร์",
  SAT: "เสาร์",
};

/** Short forms for the grid header, where a full Thai day name will not fit. */
export const DAY_SHORT: Record<DayKey, string> = {
  MON: "จ.",
  TUE: "อ.",
  WED: "พ.",
  THU: "พฤ.",
  FRI: "ศ.",
  SAT: "ส.",
};

/**
 * The three teaching periods.
 *
 * Note that PM ends and EVE begins at exactly 16:00. Nothing separates them,
 * so every overlap test in this codebase treats a range as half-open
 * `[start, end)` — see `overlaps` below. Written the other way, every
 * afternoon class would "conflict" with every evening class in the same room.
 */
export const PERIODS: Record<PeriodKey, { label: string; start: string; end: string }> = {
  AM: { label: "เช้า", start: "09:00", end: "12:00" },
  PM: { label: "บ่าย", start: "13:00", end: "16:00" },
  EVE: { label: "เย็น", start: "16:00", end: "19:00" },
};

/** Every slot in the week, in reading order: Monday morning first. */
export const ALL_SLOTS: SlotId[] = DAYS.flatMap((day) =>
  PERIOD_KEYS.map((period) => `${day}_${period}` as SlotId),
);

export function makeSlotId(day: DayKey, period: PeriodKey): SlotId {
  return `${day}_${period}`;
}

export function parseSlotId(slotId: SlotId): { day: DayKey; period: PeriodKey } {
  const [day, period] = slotId.split("_") as [DayKey, PeriodKey];
  return { day, period };
}

export function isSlotId(value: string): value is SlotId {
  return (ALL_SLOTS as string[]).includes(value);
}

/** "พุธเช้า" — the phrase a coordinator would actually say on the phone. */
export function slotLabel(slotId: SlotId): string {
  const { day, period } = parseSlotId(slotId);
  return `${DAY_LABELS[day]}${PERIODS[period].label}`;
}

/** "พ. เช้า · 09:00–12:00" — for tooltips and detail rows. */
export function slotLabelWithTime(slotId: SlotId): string {
  const { day, period } = parseSlotId(slotId);
  return `${DAY_SHORT[day]} ${PERIODS[period].label} · ${PERIODS[period].start}–${PERIODS[period].end}`;
}

/** Position in `ALL_SLOTS`. Used as the deterministic tie-breaker everywhere. */
export function slotRank(slotId: SlotId): number {
  return ALL_SLOTS.indexOf(slotId);
}

/** "09:30" -> 570. Minutes from midnight, so ranges can be compared as numbers. */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function fromMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Half-open overlap: `[startA, endA)` against `[startB, endB)`.
 *
 * Half-open is not a stylistic choice here. PM ends at 16:00 and EVE starts at
 * 16:00, so a closed-interval test (`startA <= endB && startB <= endA`) reports
 * every afternoon/evening pair in a room as a clash. There is a test for
 * exactly this case in scripts/check-scheduler.mjs.
 */
export function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
}

/** Does a real time range stay inside its period's nominal bounds? */
export function fitsInPeriod(period: PeriodKey, start: string, end: string): boolean {
  const bounds = PERIODS[period];
  return isTimeRange(start, end) && toMinutes(start) >= toMinutes(bounds.start) && toMinutes(end) <= toMinutes(bounds.end);
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isTimeRange(start: unknown, end: unknown): boolean {
  return isTime(start) && isTime(end) && start < end;
}
