"use client";

import { usePlanState } from "@/lib/use-plan-state";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatNumber } from "@/lib/format";
import { roomDraftFrom, validateRoomDraft, type RoomDraft } from "@/lib/rooms.ts";
import type { PlanRoom } from "@/lib/plan-types.ts";

/** `room: null` means a new room; `target: null` means the dialog is closed. */
export type RoomFormTarget = { room: PlanRoom | null };

/** A room nobody has measured yet — the honest default is "about this many". */
const NEW_ROOM: RoomDraft = {
  name: "",
  building: "",
  floor: "",
  seats: 40,
  seatsIsEstimated: true,
  // The cautious half of the pair: a room wrongly marked READY gets filled by
  // the scheduler before anyone has asked the faculty for it, while a room
  // wrongly marked NEEDS_APPROVAL only goes unused until someone fixes it.
  tier: "NEEDS_APPROVAL",
};

/**
 * Add, edit or remove one room.
 *
 * One form for all three because they are one question — "what rooms does the
 * department have" — and a separate "add room" page would be a second place
 * for the tier wording to drift out of step with the room list's two headings.
 *
 * Deleting asks twice, and the second ask counts the classes that will fall
 * out of the plan with the room. That number is the whole reason to hesitate,
 * so it belongs in the sentence rather than in a generic "are you sure".
 */
export function RoomDialog({
  target,
  rooms,
  assignedCount,
  onSave,
  onDelete,
  onClose,
}: {
  target: RoomFormTarget | null;
  rooms: PlanRoom[];
  /** Classes currently sitting in the room being edited. */
  assignedCount: number;
  onSave: (draft: RoomDraft) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const plan = usePlanState();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<RoomDraft>(NEW_ROOM);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const editing = target?.room ?? null;

  useEffect(() => {
    if (!target) {
      if (dialogRef.current?.open) dialogRef.current.close();
      return;
    }
    setDraft(target.room ? roomDraftFrom(target.room) : NEW_ROOM);
    setError(null);
    setConfirmingDelete(false);
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }, [target]);

  /** The buildings already in use, so a second room in one of them is a pick. */
  const buildings = useMemo(
    () => [...new Set(rooms.map((room) => room.building.trim()).filter(Boolean))].sort(),
    [rooms],
  );

  const submit = () => {
    const problem = validateRoomDraft(draft, rooms, editing?.id);
    if (problem) {
      setError(problem);
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), building: draft.building.trim(), floor: draft.floor.trim() });
  };

  return (
    <dialog
      className="course-dialog room-dialog"
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="dialog-header">
        <div>
          <p className="section-kicker">{editing ? "แก้ไขห้องเรียน" : "เพิ่มห้องเรียน"}</p>
          <h2>{editing ? editing.name : "ห้องใหม่"}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="ปิดหน้าต่าง">×</button>
      </div>

      <div className="dialog-content">
        {target && plan.error ? <p className="room-form-error" role="alert">{plan.error}</p> : null}
        {/* A plain form, submitted by its own button: Enter in any field then
            does what Enter in a form does, without a keydown handler per input. */}
        <form
          className="room-form"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <label className="room-form-wide">
            ชื่อห้อง
            <input
              type="text"
              value={draft.name}
              placeholder="เช่น ตึกร้อยปี ห้อง 406"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>

          <label>
            อาคาร
            <input
              type="text"
              list="room-buildings"
              value={draft.building}
              placeholder="เช่น ตึกร้อยปี (คณะวิศวะฯ)"
              onChange={(event) => setDraft({ ...draft, building: event.target.value })}
            />
            <datalist id="room-buildings">
              {buildings.map((building) => <option key={building} value={building} />)}
            </datalist>
          </label>

          <label>
            ชั้น
            <input
              type="text"
              value={draft.floor}
              placeholder="เช่น 4"
              onChange={(event) => setDraft({ ...draft, floor: event.target.value })}
            />
          </label>

          <label>
            จำนวนที่นั่ง
            <input
              type="number"
              min={1}
              max={2000}
              value={Number.isFinite(draft.seats) ? draft.seats : ""}
              onChange={(event) => setDraft({ ...draft, seats: Number.parseInt(event.target.value, 10) })}
            />
          </label>

          <label className="room-form-check">
            <input
              type="checkbox"
              checked={draft.seatsIsEstimated}
              onChange={(event) => setDraft({ ...draft, seatsIsEstimated: event.target.checked })}
            />
            <span>
              ตัวเลขนี้ยังไม่ได้ยืนยันกับผู้ดูแลอาคาร
              <small>ระบบจะถือเป็นขอบล่าง แสดงเป็น ~{formatNumber(draft.seats || 0)} และไม่จัดวิชาที่รับเกินนี้ลงห้อง</small>
            </span>
          </label>

          {/* Radios, not a dropdown: the two tiers are not two values of one
              property — one is a room the department can use this afternoon and
              the other is a request someone has to file — and a closed select
              shows only the one already chosen. */}
          <fieldset className="tier-choice room-form-wide">
            <legend>หมวดของห้อง</legend>
            <label>
              <input
                type="radio"
                name="room-tier"
                checked={draft.tier === "READY"}
                onChange={() => setDraft({ ...draft, tier: "READY" })}
              />
              <span>
                ใช้ได้ทันที
                <small>ห้องของภาค จัดลงได้เลย ระบบจะเลือกห้องกลุ่มนี้ก่อนเสมอ</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="room-tier"
                checked={draft.tier === "NEEDS_APPROVAL"}
                onChange={() => setDraft({ ...draft, tier: "NEEDS_APPROVAL" })}
              />
              <span>
                ต้องขออนุมัติก่อนใช้
                <small>ห้องของคณะวิศวะฯ ระบบจะใช้ต่อเมื่อห้องกลุ่มแรกไม่พอ</small>
              </span>
            </label>
          </fieldset>

          {error ? <p className="room-form-error" role="alert">{error}</p> : null}

          <div className="dialog-actions room-form-wide">
            {editing ? (
              confirmingDelete ? (
                <span className="delete-confirm">
                  <span>
                    ลบ {editing.name}?
                    {assignedCount > 0
                      ? ` ${formatNumber(assignedCount)} คาบในห้องนี้จะกลับไปเป็นวิชาที่ยังไม่ได้จัด`
                      : " ห้องนี้ยังไม่มีวิชาอยู่"}
                  </span>
                  <button className="danger-button" type="button" onClick={onDelete}>ยืนยันลบ</button>
                  <button className="text-button" type="button" onClick={() => setConfirmingDelete(false)}>
                    ไม่ลบ
                  </button>
                </span>
              ) : (
                <button className="text-button danger-text" type="button" onClick={() => setConfirmingDelete(true)}>
                  ลบห้องนี้
                </button>
              )
            ) : (
              <span className="panel-caption">ห้องที่เพิ่มจะถูกเก็บไว้ในเครื่องนี้ ไม่กระทบข้อมูลตั้งต้นของภาค</span>
            )}
            <span className="dialog-actions-end">
              <button className="secondary-button" type="button" onClick={onClose}>ยกเลิก</button>
              <button className="primary-button" type="submit">{editing ? "บันทึก" : "เพิ่มห้อง"}</button>
            </span>
          </div>
        </form>
      </div>
    </dialog>
  );
}
