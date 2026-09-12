import { DAYS, PERIOD_KEYS, type DayKey, type PeriodKey } from "./slots.ts";
export const dayFilter = (value?: string): DayKey | "" => DAYS.includes(value as DayKey) ? value as DayKey : "";
export const periodFilter = (value?: string): PeriodKey | "" => PERIOD_KEYS.includes(value as PeriodKey) ? value as PeriodKey : "";
