"use client";

import type { ReactNode } from "react";
import { PlanStorage } from "@/components/plan-storage";
import { usePlanState } from "@/lib/use-plan-state";
import { AppNav } from "@/components/app-nav";
import { formatUpdated } from "@/lib/format";

/**
 * The frame every page of the planner sits in.
 *
 * The three v1 dashboards each carried their own copy of this header, which is
 * how the nav ended up in a different position on every page and the "you have
 * unsaved edits" notice existed on two of them. One shell, one header, and a
 * page below it that only has to render its own content.
 */
export function PlanShell({
  eyebrow,
  title,
  lastUpdated,
  timezone,
  isMock,
  editedAt,
  onReset,
  planTools = false,
  children,
}: {
  eyebrow: string;
  title: string;
  lastUpdated: string;
  timezone: string;
  isMock: boolean;
  editedAt: string | null;
  onReset: () => void;
  /** Show the whole-plan file buttons. The overview asks for them; see PlanStorage. */
  planTools?: boolean;
  children: ReactNode;
}) {
  const plan = usePlanState();
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">N</span>
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
          </div>
        </div>
        <AppNav />
        <div className="header-meta">
          {editedAt ? (
            // The full stamp is in the tooltip: spelled out in the bar it pushes
            // the source badge and the update time onto a second line, and what
            // a reader needs at a glance is that local edits exist at all.
            <span className="local-edit-note" title={`แก้ไขล่าสุด ${formatUpdated(editedAt, timezone)}`}>
              มีการแก้ไขแผน
              <button className="local-edit-reset" type="button" onClick={() => { if (window.confirm("คืนค่าเริ่มต้นทั้งแผน? สามารถเลิกทำรายการล่าสุดได้")) onReset(); }}>
                คืนค่าเริ่มต้น
              </button>
            </span>
          ) : null}
          {isMock ? (
            <span className="demo-badge">
              <span className="status-dot" aria-hidden="true" />
              ข้อมูลตัวอย่าง
            </span>
          ) : null}
          <span>อัปเดต {formatUpdated(lastUpdated, timezone)}</span>
        </div>
      </header>
      <main className="page-content">
        <PlanStorage tools={planTools} />
        {plan.ready && plan.recoveryRaw === null ? children : <p role="status">{plan.ready ? "กู้คืนข้อมูลจากแถบด้านบนเพื่อเปิดแผน" : "กำลังโหลดแผน…"}</p>}
      </main>
    </div>
  );
}
