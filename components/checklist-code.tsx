"use client";

import { useEffect, useRef, useState } from "react";

/** Keep typing responsive while storage writes queue; the parent pins this row until blur. */
export function ChecklistCode({ value, label, onChange, onEditing }: {
  value: string; label: string; onChange: (value: string) => void; onEditing: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return <input className="checklist-code" type="text" value={draft} placeholder="ยังไม่มีรหัส" aria-label={label}
    onFocus={() => { focused.current = true; onEditing(true); }}
    onChange={(event) => { setDraft(event.target.value); onChange(event.target.value); }}
    onBlur={() => { focused.current = false; onEditing(false); }}
  />;
}
