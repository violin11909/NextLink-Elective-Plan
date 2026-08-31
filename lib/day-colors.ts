import type { DayKey } from "./slots.ts";

/**
 * The traditional Thai colour of each weekday, restated so it can be read.
 *
 * Monday's yellow and Thursday's orange are pale enough that text in them
 * disappears against white, so each day gets three values instead of one: a
 * light wash for the chip, a border, and a dark step of the same hue for the
 * text. The hue is what carries the tradition; the lightness is what makes it
 * legible. Every chip also spells the day out, so the colour is a reminder
 * rather than the only cue.
 */
export const DAY_COLORS: Record<DayKey, { ink: string; bg: string; border: string }> = {
  MON: { ink: "#7a5a00", bg: "#fdf6e0", border: "#eddfae" }, // เหลือง
  TUE: { ink: "#a3325f", bg: "#fdeef4", border: "#f2c9da" }, // ชมพู
  WED: { ink: "#1a6b3f", bg: "#e9f7ef", border: "#b9e2ca" }, // เขียว
  THU: { ink: "#9a4a12", bg: "#fdf0e6", border: "#f2ceac" }, // ส้ม
  FRI: { ink: "#1c5fa8", bg: "#eaf3fd", border: "#b9d6f2" }, // ฟ้า
  SAT: { ink: "#5b3a9e", bg: "#f1ecfd", border: "#cfc0f0" }, // ม่วง
};
