import type { planSchedule } from "./scheduler.ts";
import type { ScheduleResult } from "./plan-types.ts";

/** Heavy search never blocks typing, navigation or cancellation on the main thread. */
export function scheduleInWorker(input: Parameters<typeof planSchedule>[0], signal: AbortSignal): Promise<ScheduleResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("ยกเลิกการจัดตารางแล้ว")); return; }
    const worker = new Worker(new URL("./scheduler.worker.ts", import.meta.url));
    const finish = (result?: ScheduleResult, error?: string) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (result) resolve(result); else reject(new Error(error ?? "จัดตารางไม่สำเร็จ"));
    };
    const abort = () => finish(undefined, "ยกเลิกการจัดตารางแล้ว แผนเดิมยังอยู่");
    const timeout = setTimeout(() => finish(undefined, "การจัดตารางใช้เวลานานเกิน 30 วินาที กรุณาลดขอบเขตหรือเพิ่มช่วงที่สะดวก แผนเดิมยังอยู่"), 30000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ result?: ScheduleResult; error?: string }>) => finish(data.result, data.error);
    worker.onerror = () => finish(undefined, "โหลดตัวจัดตารางไม่สำเร็จ กรุณาลองใหม่");
    worker.onmessageerror = () => finish(undefined, "อ่านผลการจัดตารางไม่สำเร็จ");
    worker.postMessage(input);
  });
}
