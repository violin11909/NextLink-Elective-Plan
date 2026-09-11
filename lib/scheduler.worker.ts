import { planSchedule } from "./scheduler.ts";

type Input = Parameters<typeof planSchedule>[0];
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Input>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ result: planSchedule(data) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : "จัดตารางไม่สำเร็จ" }); }
};
