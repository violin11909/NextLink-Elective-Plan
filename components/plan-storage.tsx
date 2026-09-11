"use client";

import { useRef } from "react";
import { usePlanState } from "@/lib/use-plan-state";

function download(raw: string, term: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `nextlink-plan-${term}-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Persistent controls live with the layout's store, including undo after navigation. */
export function PlanStorage() {
  const plan = usePlanState();
  const file = useRef<HTMLInputElement>(null);
  const backup = () => download(plan.recoveryRaw ?? JSON.stringify(plan.document, null, 2), plan.document.termId);
  return (
    <section className="plan-storage" aria-label="การบันทึกแผน">
      <div className="plan-storage-actions">
        <span role="status">
          {plan.planning ? "กำลังจัดตาราง…" : plan.status === "loading" ? "กำลังโหลดแผน…" : plan.status === "saving" ? "กำลังบันทึก…" : plan.status === "error" ? "แผนยังบันทึกไม่สำเร็จ" : plan.editedAt ? "บันทึกแล้วในเบราว์เซอร์นี้" : "ยังไม่มีการแก้ไขแผน"}
        </span>
        {plan.planning ? <button type="button" className="secondary-button" onClick={plan.cancelPlanning}>ยกเลิกการจัดตาราง</button> : null}
        <button type="button" className="secondary-button" disabled={!plan.ready} onClick={backup}>สำรองแผน JSON</button>
        <button type="button" className="secondary-button" disabled={!plan.ready || plan.recoveryRaw !== null} onClick={() => file.current?.click()}>นำเข้าแผน</button>
        <button type="button" className="secondary-button" disabled={!plan.canUndo || plan.status === "saving"} onClick={() => void plan.undo()}>เลิกทำรายการล่าสุด</button>
        <input ref={file} className="sr-only" type="file" accept=".json,application/json" aria-label="ไฟล์แผน JSON" onChange={async (event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (!selected || !window.confirm("แทนที่แผนปัจจุบันด้วยไฟล์นี้? สามารถเลิกทำรายการล่าสุดได้")) return;
          await plan.importPlan(await selected.text());
        }} />
      </div>
      {plan.error ? (
        <div className="plan-storage-error" role="alert">
          <p>{plan.error}</p>
          {plan.recoveryRaw !== null ? (
            <>
              <p>ข้อมูลเดิมยังอยู่ กดสำรองเพื่อเก็บไฟล์ต้นฉบับก่อนเริ่มแผนใหม่</p>
              <button type="button" className="secondary-button" onClick={async () => {
                if (!window.confirm("ดาวน์โหลดสำรองข้อมูลเดิมแล้วเริ่มแผนใหม่?")) return;
                backup();
                await plan.recoverEmpty();
              }}>สำรองและเริ่มแผนใหม่</button>
            </>
          ) : plan.status === "error" ? (
            <>
              <p>กรุณาสำรองแผนก่อนปิดหน้านี้ หากพื้นที่เต็มหรือมีแผนใหม่จากแท็บอื่น งานที่ยังไม่บันทึกอาจหายเมื่อโหลดใหม่</p>
              <button type="button" className="secondary-button" onClick={() => void plan.retry()}>ลองบันทึกอีกครั้ง</button>
            </>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => {
            if (!window.confirm("โหลดแผนที่บันทึกไว้ล่าสุด? งานที่ยังไม่บันทึกจะถูกแทนที่")) return;
            backup();
            plan.reload();
          }}>สำรองและโหลดแผนล่าสุด</button>
        </div>
      ) : null}
    </section>
  );
}
