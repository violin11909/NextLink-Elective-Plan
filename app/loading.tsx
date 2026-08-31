import { AppNav } from "@/components/app-nav";

/**
 * Shared by every page — each route segment inherits the nearest parent
 * loading UI, and all of them open with a header, a summary row and a panel.
 *
 * The header here mirrors the real one exactly, nav included. An earlier
 * version left the nav out, so moving between sections made the control the
 * reader had just clicked disappear and come back.
 */
export default function Loading() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">N</div>
          <div>
            <div className="eyebrow">NEXTLINK</div>
            <h1>กำลังโหลด…</h1>
          </div>
        </div>
        <AppNav />
        <div className="header-meta" aria-hidden="true">
          <span className="skeleton skeleton-line skeleton-sm" style={{ width: 120 }} />
        </div>
      </header>
      <main className="page-content">
        <p className="sr-only" role="status">กำลังโหลดแผนตารางสอน</p>
        <section className="kpi-grid" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="kpi-card skeleton-card" key={index}>
              <span className="skeleton skeleton-line skeleton-sm" />
              <span className="skeleton skeleton-line skeleton-lg" />
              <span className="skeleton skeleton-line" />
            </div>
          ))}
        </section>
        <section className="panel" aria-hidden="true">
          <span className="skeleton skeleton-line skeleton-md" />
          <div className="skeleton-rows">
            {Array.from({ length: 6 }, (_, index) => (
              <span className="skeleton skeleton-row" key={index} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
