"use client";

import { usePlanState } from "@/lib/use-plan-state";

import { useEffect, useMemo, useRef, useState } from "react";
import { slotLabelWithTime, type SlotId } from "@/lib/slots.ts";
import type { PlanRoom } from "@/lib/plan-types.ts";

export type BookingTarget = { room: PlanRoom; slotId: SlotId; reason: string | null };

/** Offered as a starting point; anything typed over them is kept as typed. */
const COMMON_REASONS = ["วิชาบังคับของภาคใช้อยู่", "สอบกลางภาค", "งานของคณะ", "ปิดปรับปรุงห้อง"];

/**
 * Hold one period in one room for something that is not an elective.
 *
 * The reason is free text and required, because the note *is* the feature: a
 * period held for no stated reason is a period nobody dares release, and six
 * months later nobody remembers whether it was a compulsory class or a
 * plumber. The wording other rooms already use is offered as suggestions, so
 * the same booking does not end up spelled three ways across the board.
 *
 * A booking is a real hold, not a sticky note: it is the same `blockedSlots`
 * the scheduler and the drag rules have always honoured.
 */
export function BookingDialog({
  target,
  rooms,
  onSave,
  onClose,
}: {
  target: BookingTarget | null;
  rooms: PlanRoom[];
  /** `null` releases the period. */
  onSave: (reason: string | null) => void;
  onClose: () => void;
}) {
  const plan = usePlanState();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      if (dialogRef.current?.open) dialogRef.current.close();
      return;
    }
    setReason(target.reason ?? "");
    setError(null);
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }, [target]);

  const suggestions = useMemo(() => {
    const used = rooms.flatMap((room) => room.blockedSlots.map((entry) => entry.reason.trim())).filter(Boolean);
    return [...new Set([...used, ...COMMON_REASONS])].sort();
  }, [rooms]);

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("ต้องบอกว่าคาบนี้ถูกกันไว้ให้อะไร เช่น ชื่อวิชาบังคับ");
      return;
    }
    onSave(trimmed);
  };

  return (
    <dialog
      className="course-dialog booking-dialog"
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="dialog-header">
        <div>
          <p className="section-kicker">{target ? target.room.name : ""}</p>
          <h2>{target ? slotLabelWithTime(target.slotId) : ""}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="ปิดหน้าต่าง">×</button>
      </div>

      <div className="dialog-content">
        {target && plan.error ? <p className="room-form-error" role="alert">{plan.error}</p> : null}
        <form className="room-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className="room-form-wide">
            บันทึก
            <input
              type="text"
              list="booking-reasons"
              value={reason}
              placeholder="เช่น 2110101 Computer Programming"
              onChange={(event) => setReason(event.target.value)}
            />
            <datalist id="booking-reasons">
              {suggestions.map((item) => <option key={item} value={item} />)}
            </datalist>
          </label>

          <p className="panel-caption room-form-wide">
            คาบที่กันไว้จะไม่ถูกจัดตารางอัตโนมัติ และลากวิชามาวางไม่ได้ จนกว่าจะปลดการกัน
          </p>

          {error ? <p className="room-form-error" role="alert">{error}</p> : null}

          <div className="dialog-actions room-form-wide">
            {target?.reason ? (
              <button className="text-button danger-text" type="button" onClick={() => onSave(null)}>
                ปลดการกันคาบนี้
              </button>
            ) : (
              <span className="panel-caption">ปลดคืนได้ทุกเมื่อจากช่องเดิม</span>
            )}
            <span className="dialog-actions-end">
              <button className="secondary-button" type="button" onClick={onClose}>ยกเลิก</button>
              <button className="primary-button" type="submit">{target?.reason ? "บันทึก" : "กันคาบนี้"}</button>
            </span>
          </div>
        </form>
      </div>
    </dialog>
  );
}
