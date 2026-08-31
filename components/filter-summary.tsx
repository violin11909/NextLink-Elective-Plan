"use client";

/** `value` is omitted for a plain on/off filter, which reads as just its label. */
export type ActiveFilter = { label: string; value?: string; onClear: () => void };

/**
 * The count of matching rows, plus one removable chip per active filter.
 *
 * All three dashboards hand-rolled this as a chain of ternaries — one per
 * filter, each repeating the same button markup — so adding a filter meant
 * writing the chip again, and a change to how chips look meant three edits.
 * Here the caller supplies only what is active.
 */
export function FilterSummary({ summary, filters }: { summary: string; filters: ActiveFilter[] }) {
  return (
    <div className="filter-summary">
      <span>{summary}</span>
      {filters.map((filter) => (
        <button
          key={filter.label}
          type="button"
          onClick={filter.onClear}
          aria-label={`ล้างตัวกรอง ${filter.label}${filter.value ? `: ${filter.value}` : ""}`}
        >
          {filter.value ? `${filter.label}: ${filter.value}` : filter.label} ×
        </button>
      ))}
    </div>
  );
}
