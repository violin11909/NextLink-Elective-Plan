"use client";

import { DAYS, DAY_LABELS, PERIODS, PERIOD_KEYS, parseSlotId, type DayKey, type PeriodKey, type SlotId } from "@/lib/slots.ts";

/**
 * Filter a list of courses by the day and period a company said it can teach.
 *
 * Two controls rather than one list of eighteen periods: the question is almost
 * always half-specified — "who can do Wednesday", "who can do evenings" — and a
 * combined list makes the reader pick a whole period to ask half a question.
 *
 * Both pages that filter courses use this, so the wording and the behaviour
 * cannot drift apart between them.
 */
export function SlotFilters({
  day,
  period,
  onDay,
  onPeriod,
}: {
  day: DayKey | "";
  period: PeriodKey | "";
  onDay: (next: DayKey | "") => void;
  onPeriod: (next: PeriodKey | "") => void;
}) {
  return (
    <>
      <label>
        วันที่สะดวก
        <select value={day} onChange={(event) => onDay(event.target.value as DayKey | "")}>
          <option value="">ทุกวัน</option>
          {DAYS.map((key) => <option key={key} value={key}>{DAY_LABELS[key]}</option>)}
        </select>
      </label>
      <label>
        คาบที่สะดวก
        <select value={period} onChange={(event) => onPeriod(event.target.value as PeriodKey | "")}>
          <option value="">ทุกคาบ</option>
          {PERIOD_KEYS.map((key) => (
            <option key={key} value={key}>
              {PERIODS[key].label} · {PERIODS[key].start}–{PERIODS[key].end}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/**
 * Day and period narrow independently, so "Wednesday" and "morning" together
 * mean Wednesday morning — not "anything on Wednesday plus anything in the
 * morning". Each period a company offered is tested against both.
 */
export function matchesSlotFilter(availability: SlotId[], day: DayKey | "", period: PeriodKey | ""): boolean {
  if (!day && !period) return true;
  return availability.some((slotId) => {
    const parsed = parseSlotId(slotId);
    if (day && parsed.day !== day) return false;
    if (period && parsed.period !== period) return false;
    return true;
  });
}
