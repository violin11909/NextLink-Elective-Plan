"use client";

export const PAGE_SIZE = 25;

/**
 * Only rendered once a list outgrows a single page, so the ten-row demo looks
 * exactly as it did while a real term's worth of rows stays navigable.
 */
export function Pager({
  page,
  pageCount,
  total,
  unit,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  unit: string;
  onChange: (next: number) => void;
}) {
  if (pageCount <= 1) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <nav className="pager" aria-label={`แบ่งหน้ารายการ${unit}`}>
      <span className="pager-range">
        {from}–{to} จาก {total} {unit}
      </span>
      <span className="pager-controls">
        <button className="row-action" type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          ก่อนหน้า
        </button>
        <span className="pager-position" aria-current="page">
          หน้า {page} / {pageCount}
        </span>
        <button className="row-action" type="button" onClick={() => onChange(page + 1)} disabled={page >= pageCount}>
          ถัดไป
        </button>
      </span>
    </nav>
  );
}
