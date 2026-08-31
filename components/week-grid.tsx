"use client";

import type { ReactNode } from "react";
import { DAYS, DAY_LABELS, DAY_SHORT, PERIODS, PERIOD_KEYS, makeSlotId, type SlotId } from "@/lib/slots.ts";

/**
 * The week, six days across and three periods down.
 *
 * The same grid serves the whole-department view and a single room's timetable;
 * only what goes in a cell differs, so that is the one thing the caller
 * supplies. Rendering the two shapes from one component is what keeps a change
 * to the grid from having to be made twice and landing differently.
 *
 * Below 760px the grid becomes a list of days. A six-column table on a phone
 * either scrolls sideways — where the day you are looking at leaves the screen
 * along with its header — or squeezes each column below the width of a Thai
 * course title. Neither is worth keeping the table shape for.
 */
export function WeekGrid({
  renderCell,
  label,
}: {
  renderCell: (slotId: SlotId) => ReactNode;
  label: string;
}) {
  return (
    <>
      <div className="week-grid" role="grid" aria-label={label}>
        <div className="week-grid-row week-grid-header-row" role="row">
          <span className="week-grid-corner" role="presentation" />
          {DAYS.map((day) => (
            <span className="week-grid-head" key={day} role="columnheader">
              <span className="week-day-full">{DAY_LABELS[day]}</span>
              <span className="week-day-short" aria-hidden="true">{DAY_SHORT[day]}</span>
            </span>
          ))}
        </div>
        {PERIOD_KEYS.map((period) => (
          <div className="week-grid-row" key={period} role="row">
            <span className="period-label" role="rowheader">
              <strong>{PERIODS[period].label}</strong>
              <small>{PERIODS[period].start}–{PERIODS[period].end}</small>
            </span>
            {DAYS.map((day) => (
              <div className="week-grid-cell" key={day} role="gridcell">
                {renderCell(makeSlotId(day, period))}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="week-day-list">
        {DAYS.map((day) => (
          <section className="week-day-card" key={day}>
            <h4>{DAY_LABELS[day]}</h4>
            {PERIOD_KEYS.map((period) => (
              <div className="week-day-period" key={period}>
                <span className="period-label">
                  <strong>{PERIODS[period].label}</strong>
                  <small>{PERIODS[period].start}–{PERIODS[period].end}</small>
                </span>
                <div className="week-day-slot">{renderCell(makeSlotId(day, period))}</div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
