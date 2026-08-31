"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent, RefObject, SyntheticEvent } from "react";

const DISCARD_PROMPT = "ยังไม่ได้บันทึกการแก้ไข ปิดหน้าต่างนี้แล้วข้อมูลที่แก้ไว้จะหายไป ต้องการปิดหรือไม่?";

/**
 * Selecting a record, opening the dialog for it, and putting focus back where
 * it came from afterwards.
 *
 * All three dashboards did this identically, which is why the focus-restore and
 * the focus-the-dialog-on-open fixes each had to be written three times.
 */
export function useRecordDialog<T extends { id: string }>(records: T[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const selected = records.find((record) => record.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      dialogRef.current?.showModal();
      // Native <dialog> focuses the first focusable child, which would announce
      // the edit button before the record it belongs to.
      dialogRef.current?.focus();
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }, [selected]);

  const open = useCallback((id: string, trigger?: HTMLElement) => {
    lastTriggerRef.current = trigger ?? null;
    setSelectedId(id);
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setSelectedId(null);
    window.setTimeout(() => lastTriggerRef.current?.focus(), 0);
  }, []);

  return { selected, dialogRef, open, close } as {
    selected: T | null;
    dialogRef: RefObject<HTMLDialogElement | null>;
    open: (id: string, trigger?: HTMLElement) => void;
    close: () => void;
  };
}

/**
 * The draft lifecycle inside a record dialog: enter edit mode, track changes,
 * save, and refuse to throw away unsaved work on Esc or a backdrop click.
 *
 * The record and draft shapes differ per dashboard — a course draft and a MOU
 * draft list different fields for different reasons — but the lifecycle around
 * them is the same, and changing it should be one edit rather than three.
 */
export function useRecordEditor<TRecord extends { id: string }, TDraft>({
  record,
  toDraft,
  onSave,
  onClose,
}: {
  record: TRecord | null;
  toDraft: (record: TRecord) => TDraft;
  onSave: (id: string, draft: TDraft) => void;
  onClose: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<TDraft | null>(null);
  const [saveMessage, setSaveMessage] = useState("");

  // Held in a ref so a caller passing an inline function does not re-run the
  // reset effect on every render and wipe the draft mid-edit.
  const toDraftRef = useRef(toDraft);
  toDraftRef.current = toDraft;

  useEffect(() => {
    setIsEditing(false);
    setDraft(record ? toDraftRef.current(record) : null);
    setSaveMessage("");
  }, [record?.id]);

  const updateDraft = <K extends keyof TDraft>(field: K, value: TDraft[K]) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const startEditing = () => {
    if (!record) return;
    setDraft(toDraftRef.current(record));
    setSaveMessage("");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    if (record) setDraft(toDraftRef.current(record));
    setSaveMessage("");
    setIsEditing(false);
  };

  const saveEditing = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!record || !draft) return;
    onSave(record.id, draft);
    setIsEditing(false);
    setSaveMessage("บันทึกการแก้ไขแล้ว");
  };

  const hasUnsavedEdits =
    isEditing && Boolean(record) && Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(toDraftRef.current(record!));

  const confirmDiscard = () => !hasUnsavedEdits || window.confirm(DISCARD_PROMPT);

  const requestClose = () => {
    if (confirmDiscard()) onClose();
  };

  /** For <dialog onCancel>: Esc must be refusable, so preventDefault on "stay". */
  const handleCancel = (event: SyntheticEvent) => {
    if (!confirmDiscard()) {
      event.preventDefault();
      return;
    }
    onClose();
  };

  const handleBackdropClick = (event: MouseEvent) => {
    if (event.target === event.currentTarget) requestClose();
  };

  return {
    isEditing,
    draft,
    setDraft,
    saveMessage,
    updateDraft,
    startEditing,
    cancelEditing,
    saveEditing,
    requestClose,
    handleCancel,
    handleBackdropClick,
  };
}
