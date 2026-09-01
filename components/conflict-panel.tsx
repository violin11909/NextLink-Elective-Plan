"use client";

import { QUEUE_META } from "@/lib/queue";
import { slotLabel } from "@/lib/slots.ts";
import type { Conflict } from "@/lib/conflicts.ts";
import type { PlanGap } from "@/lib/use-plan-state";
import type { Suggestion } from "@/lib/plan-types.ts";

/**
 * What needs attention, and what to do about it.
 *
 * A planner that reports "3 courses could not be scheduled" has handed the
 * problem back along with none of what it learned while failing to solve it.
 * Every row here names the course or room in the way, and a course that could
 * not be placed carries buttons that act on the obstruction rather than
 * describing it.
 */
export function ConflictPanel({
  conflicts,
  gaps,
  onSuggestion,
}: {
  /** Already narrowed to the page being shown — this only renders. */
  conflicts: Conflict[];
  gaps: PlanGap[];
  onSuggestion?: (suggestion: Suggestion) => void;
}) {
  const shown = conflicts;
  const gapById = new Map(gaps.map((gap) => [gap.course.id, gap]));

  if (shown.length === 0) {
    return <p className="panel-caption">ไม่มีรายการค้าง</p>;
  }

  return (
    <ul className="conflict-list">
      {shown.map((conflict) => {
        const gap = conflict.code === "UNDER_SCHEDULED" ? gapById.get(conflict.courseIds[0]) : null;
        return (
          <li className="conflict-row" key={conflict.id}>
            <span className={`follow-up-icon ${QUEUE_META[conflict.severity].className}`} aria-hidden="true">
              {QUEUE_META[conflict.severity].icon}
            </span>
            <div className="conflict-copy">
              {/* The urgency sits with the heading it describes. Alone in the
                  right column it was the width of a word floating a long way
                  from the row it belonged to, and on a short row the space
                  between them was the widest thing in the panel. */}
              <span className="conflict-title">
                <strong>{conflict.title}</strong>
                <span className={`conflict-badge ${QUEUE_META[conflict.severity].className}`}>
                  {QUEUE_META[conflict.severity].label}
                </span>
              </span>
              <small>
                {conflict.providers.length > 0 ? (
                  <>
                    <span className="conflict-provider">{conflict.providers.join(" · ")}</span>
                    {" · "}
                  </>
                ) : null}
                {conflict.detail}
              </small>
              {gap ? (
                <ul className="conflict-slot-list">
                  {gap.reason.perSlot.map((slot) => (
                    <li key={slot.slotId}>
                      <span className="conflict-slot-name">{slotLabel(slot.slotId)}</span>
                      {slot.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {/* Actions and the urgency label share the right column, level with
                the heading. Underneath the text the buttons pushed every row
                taller while the right third of a one-line row sat empty. */}
            {gap && onSuggestion && gap.reason.suggestions.length > 0 ? (
              <div className="conflict-side">
                {gap.reason.suggestions.map((suggestion) => (
                  <button
                    className="selection-chip"
                    key={suggestion.label}
                    type="button"
                    onClick={() => onSuggestion(suggestion)}
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
