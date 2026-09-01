"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Toast = { message: string; undo?: () => void };

/**
 * Undo sits ~30 tab stops from the table control that triggers it, so a short
 * timer made it mouse-only. Ten seconds plus a hold while the toast is hovered
 * or focused gives keyboard and screen-reader users a usable window.
 */
const TOAST_MS = 5000;

/** Confirms an inline status change and offers a way back for a few seconds. */
export function useStatusToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const show = useCallback((message: string, undo?: () => void) => {
    setToast({ message, undo });
    startTimer();
  }, [startTimer]);

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, []);

  useEffect(() => clearTimer, []);

  return { toast, show, dismiss, holdTimer: clearTimer, resumeTimer: startTimer };
}

export function StatusToast({
  toast,
  onDismiss,
  onHold,
  onResume,
}: {
  toast: Toast | null;
  onDismiss: () => void;
  onHold?: () => void;
  onResume?: () => void;
}) {
  // The live region stays mounted so assistive tech announces each new message
  // instead of only noticing the first one.
  return (
    <div
      className={toast ? "toast" : "sr-only"}
      role="status"
      aria-live="polite"
      onMouseEnter={onHold}
      onMouseLeave={onResume}
      onFocusCapture={onHold}
      onBlurCapture={onResume}
    >
      {toast ? (
        <>
          <span className="toast-message">{toast.message}</span>
          {toast.undo ? (
            <button
              className="toast-undo"
              type="button"
              onClick={() => {
                toast.undo?.();
                onDismiss();
              }}
            >
              เลิกทำ
            </button>
          ) : null}
          <button className="toast-dismiss" type="button" onClick={onDismiss} aria-label="ปิดข้อความแจ้งเตือน">
            ×
          </button>
        </>
      ) : null}
    </div>
  );
}
