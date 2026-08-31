"use client";

import { useEffect } from "react";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">N</div>
          <div>
            <div className="eyebrow">NEXTLINK</div>
            <h1>โหลดข้อมูลไม่สำเร็จ</h1>
          </div>
        </div>
      </header>
      <main className="page-content">
        <section className="panel">
          <div className="load-error" role="alert">
            <p>โหลดข้อมูลแผนตารางสอนไม่สำเร็จ แผนที่แก้ไว้ในเครื่องนี้ยังอยู่ ลองโหลดหน้านี้ใหม่อีกครั้ง</p>
            {error.digest ? <p className="panel-caption">รหัสอ้างอิงสำหรับแจ้งผู้ดูแลระบบ: {error.digest}</p> : null}
            <button className="primary-button" type="button" onClick={reset}>ลองโหลดใหม่</button>
          </div>
        </section>
      </main>
    </div>
  );
}
