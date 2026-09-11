import { decodePlan, emptyDocument, LEGACY_STORAGE_KEY, LEGACY_TERM_ID, storageKeyFor, type PlanData, type PlanDocument } from "./plan-document.ts";
import type { PlanPayload } from "./plan-types.ts";

export type Persistence = {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
};
export type PlanSnapshot = {
  document: PlanDocument;
  ready: boolean;
  status: "loading" | "saved" | "saving" | "error";
  error: string | null;
  recoveryRaw: string | null;
  canUndo: boolean;
};
type Mutation = (document: PlanDocument) => PlanData | Promise<PlanData>;

/** One store per app layout. Commands read fresh state inside the shared lock. */
export class PlanStore {
  readonly key: string;
  private snapshot: PlanSnapshot;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private baseRaw: string | null | undefined;
  private dirty = false;
  private undoEntry: { before: PlanDocument; afterRevision: number } | null = null;

  readonly payload: PlanPayload;
  private persistence: Persistence;
  constructor(payload: PlanPayload, persistence: Persistence) {
    this.payload = payload;
    this.persistence = persistence;
    this.key = storageKeyFor(payload.term.id);
    this.snapshot = { document: emptyDocument(payload), ready: false, status: "loading", error: null, recoveryRaw: null, canUndo: false };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<PlanSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private readCurrent(): { raw: string | null; document: PlanDocument } {
    const raw = this.persistence.read(this.key);
    const legacy = raw === null && this.payload.term.id === LEGACY_TERM_ID ? this.persistence.read(LEGACY_STORAGE_KEY) : null;
    return { raw, document: raw !== null || legacy !== null ? decodePlan((raw ?? legacy)!, this.payload).document : emptyDocument(this.payload) };
  }
  load = () => {
    if (this.snapshot.ready) return;
    this.refresh();
  };
  refresh = () => {
    // Keep unsaved edits recoverable. A retry compares the on-disk baseline
    // before it may replace anything changed by a different tab.
    if (this.dirty || this.snapshot.status === "saving") return;
    try {
      const latest = this.readCurrent();
      const changed = latest.raw !== this.baseRaw;
      this.baseRaw = latest.raw;
      if (changed) this.undoEntry = null;
      this.publish({ document: latest.document, ready: true, status: "saved", error: null, recoveryRaw: null, canUndo: Boolean(this.undoEntry) });
    } catch (error) {
      let recoveryRaw: string | null = null;
      try { recoveryRaw = this.persistence.read(this.key) ?? (this.payload.term.id === LEGACY_TERM_ID ? this.persistence.read(LEGACY_STORAGE_KEY) : null); } catch { /* storage itself may be blocked */ }
      this.publish({ ready: true, status: "error", error: error instanceof Error ? error.message : "อ่านแผนไม่สำเร็จ", recoveryRaw });
    }
  };

  mutate = (mutation: Mutation): Promise<boolean> => {
    const next = this.queue.then(() => this.perform(mutation));
    this.queue = next.catch(() => undefined);
    return next;
  };

  private async perform(mutation: Mutation): Promise<boolean> {
    if (!this.snapshot.ready) { this.publish({ error: "กำลังโหลดแผน กรุณารอสักครู่" }); return false; }
    if (this.snapshot.recoveryRaw !== null) { this.publish({ error: "ข้อมูลเดิมต้องกู้คืนหรือสำรองก่อนเริ่มแผนใหม่" }); return false; }
    this.publish({ status: "saving", error: null });
    let before: PlanDocument | undefined;
    let candidate: PlanDocument | undefined;
    try {
      return await this.persistence.exclusive(this.key, async () => {
        const latest = this.readCurrent();
        if (this.dirty && latest.raw !== this.baseRaw) throw new Error("มีการแก้แผนจากแท็บอื่นระหว่างที่บันทึกไม่ได้ กรุณาสำรองงานแล้วโหลดแผนล่าสุด");
        before = this.dirty ? this.snapshot.document : latest.document;
        this.baseRaw = latest.raw;
        const data = await mutation(before);
        const proposed = { ...before, ...data, version: 3, termId: this.payload.term.id, dataset: this.payload.dataset,
          seedRevision: this.payload.seedRevision, revision: before.revision + 1, editedAt: new Date().toISOString() };
        // Commands and imported backups pass the same schema boundary.
        candidate = decodePlan(JSON.stringify(proposed), this.payload).document;
        const raw = JSON.stringify(candidate);
        this.persistence.write(this.key, raw);
        this.baseRaw = raw;
        this.dirty = false;
        this.undoEntry = { before, afterRevision: candidate.revision };
        this.publish({ document: candidate, status: "saved", error: null, canUndo: true });
        return true;
      });
    } catch (error) {
      // Preserve a validated candidate if writing failed. A rule rejection or
      // a stale revision never replaces the currently displayed document.
      if (candidate && before) {
        this.dirty = true;
        this.undoEntry = { before, afterRevision: candidate.revision };
        this.publish({ document: candidate, canUndo: true });
      }
      this.publish({ status: candidate || !before || this.dirty ? "error" : "saved", error: error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาสำรองแผน" });
      return false;
    }
  }

  retry = async (): Promise<boolean> => {
    if (!this.dirty) { this.refresh(); return this.snapshot.status === "saved"; }
    return this.mutate((document) => document);
  };

  undo = async (): Promise<boolean> => {
    const entry = this.undoEntry;
    if (!entry) return false;
    const success = await this.mutate((current) => {
      if (current.revision !== entry.afterRevision) throw new Error("แผนเปลี่ยนจากแท็บอื่นแล้ว จึงเลิกทำรายการเก่านี้ไม่ได้");
      return entry.before;
    });
    if (success) { this.undoEntry = null; this.publish({ canUndo: false }); }
    return success;
  };

  replace = (data: PlanData, expectedRevision: number): Promise<boolean> => this.mutate((current) => {
    if (current.revision !== expectedRevision) throw new Error("แผนมีการเปลี่ยนแปลง กรุณาตรวจแผนล่าสุดก่อนแทนที่");
    return data;
  });

  /** Called only after the recovery panel offers the original bytes as a backup. */
  recoverEmpty = async (): Promise<boolean> => {
    const expected = this.snapshot.recoveryRaw;
    const next = this.queue.then(() => this.persistence.exclusive(this.key, async () => {
      const raw = this.persistence.read(this.key);
      const source = raw ?? (this.payload.term.id === LEGACY_TERM_ID ? this.persistence.read(LEGACY_STORAGE_KEY) : null);
      if (source !== expected) throw new Error("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนกู้คืน");
      const document = { ...emptyDocument(this.payload), revision: 1, editedAt: new Date().toISOString() };
      const encoded = JSON.stringify(document);
      this.persistence.write(this.key, encoded);
      this.baseRaw = encoded; this.dirty = false; this.undoEntry = null;
      this.publish({ document, ready: true, status: "saved", error: null, recoveryRaw: null, canUndo: false });
      return true;
    })).catch((error: unknown) => {
      this.publish({ status: "error", error: error instanceof Error ? error.message : "กู้คืนไม่สำเร็จ" });
      return false;
    });
    this.queue = next;
    return next;
  };

  /** Explicit discard, after the UI offers a backup; never done by a storage event. */
  reload = () => { this.dirty = false; this.undoEntry = null; this.publish({ status: "loading", canUndo: false }); this.refresh(); };
  reportError = (error: string) => this.publish({ error });
}

export function browserPersistence(): Persistence {
  return {
    read: (key) => window.localStorage.getItem(key),
    write: (key, value) => window.localStorage.setItem(key, value),
    exclusive: async (name, work) => {
      if (!navigator.locks) throw new Error("เบราว์เซอร์นี้บันทึกข้ามแท็บอย่างปลอดภัยไม่ได้ กรุณาเปิดผ่าน HTTPS ในเบราว์เซอร์รุ่นปัจจุบัน");
      return navigator.locks.request(name, work);
    },
  };
}
