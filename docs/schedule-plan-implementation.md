# แผนพัฒนา: NextLink Elective Schedule Plan

> **สถานะ: สร้างเสร็จแล้วทั้ง 6 เฟส** — เอกสารนี้เก็บไว้เป็นบันทึกการตัดสินใจ
> ระหว่างทาง สิ่งที่เป็นความจริงของโค้ดตอนนี้อยู่ที่ [`README.md`](../README.md)
> และ [`docs/data-model.md`](./data-model.md) ส่วนที่ต่างจากแผนสรุปไว้ในข้อ 11

เอกสารนี้เป็น implementation plan สำหรับแปลง `nextlink-elective-dashboard`
จาก dashboard ติดตามสถานะ 3 หน้า ให้เหลือระบบเดียว: **หน้าวางแผนตารางสอน
วิชาเลือกของภาควิชาวิศวกรรมคอมพิวเตอร์**

โจทย์หลักคือ แต่ละวิชาที่บริษัทเสนอมามี "ช่วงที่สะดวกสอน" ไม่เท่ากัน และมี
ห้องเรียนจำกัด ระบบต้องล็อกช่วงที่มีทางเลือกเดียวให้ก่อน แล้วปัดวิชาที่
ยืดหยุ่นกว่าไปช่วงอื่น

## สรุปการตัดสินใจ

| หัวข้อ | ที่เลือก |
| --- | --- |
| ขอบเขต | เหลือเฉพาะระบบวางแผน — ตัดหน้า MOU และฝึกงาน/สหกิจออก |
| กลไกจัด | Auto-assign + แก้มือได้ + ล็อก (pin) รายวิชา |
| หน่วยเวลา | จ.–ส. × 3 คาบ (09–12 / 13–16 / 16–19) ระบุเวลาจริงในคาบได้ |
| ที่เก็บข้อมูล | Mock JSON + `localStorage` (ยังไม่ต้องตั้ง Postgres) |
| ห้องเรียน | 9 ห้อง — จุฬาพัฒน์ 6 (ใช้ได้เลย) + ตึก 3/4 อีก 3 (ต้องขออนุมัติ) |
| หน้าตา | รักษาสไตล์เดิมทั้งหมด — `app/globals.css` ต่อยอด ไม่รื้อ |

---

## 1. สิ่งที่เก็บ / รื้อ / สร้างใหม่

### 1.1 เก็บไว้ทั้งหมด (นี่คือ "สไตล์เดิม" ที่ต้องรักษา)

| ไฟล์ | เหตุผล |
| --- | --- |
| `app/globals.css` | ตัวจริงของหน้าตาทั้งระบบ — token สี, type scale, `.topbar`, `.kpi-card`, `.panel`, `.status-pill`, `.tone-*`, dialog, toast, responsive 760px ต่อยอดอย่างเดียว ห้ามเขียนใหม่ |
| `app/layout.tsx` | ฟอนต์คู่ Inter + Noto Sans Thai (แก้แค่ `metadata.title`) |
| `app/loading.tsx`, `app/error.tsx`, `app/icon.svg` | skeleton และ error state ที่เข้าชุดกันแล้ว |
| `components/app-nav.tsx` | แก้แค่ `sections` array |
| `components/priority-kpi.tsx` | การ์ด KPI สีแดงใบแรก — `check-consistency.mjs` บังคับว่าทุกหน้าต้องใช้ |
| `components/queue-filter.tsx` | ปุ่มกรอง 3 ถัง (ติดปัญหา / รอข้อมูล / กำลังทำ) |
| `components/pager.tsx`, `empty-result.tsx`, `filter-summary.tsx`, `result-announcer.tsx`, `status-toast.tsx` | ชุด control กลาง + `aria-live` + toast พร้อม undo |
| `lib/queue.ts` | คำศัพท์ถังงาน `QUEUE_META` / `QUEUE_ORDER` |
| `lib/format.ts`, `lib/use-local-dataset.ts`, `lib/use-url-filters.ts`, `lib/use-record-dialog.ts` | hook กลางที่ยังใช้ตรง ๆ |
| `scripts/check-css.mjs` | static check ของ CSS — ใช้ต่อได้โดยไม่ต้องแก้ |

### 1.2 ลบทิ้ง

```
components/elective-dashboard.tsx      components/internship-dashboard.tsx
components/mou-dashboard.tsx
app/internship/                        app/mou/
app/api/elective-courses/              lib/mou-data.ts  lib/mou-statuses.ts
lib/internship-data.ts                 lib/elective-data.ts  lib/mock-data.ts
data/internship-companies.json         data/mou-companies.json
data/elective-workflow.json            scripts/export-sheet-csv.mjs
prisma/  (ทั้งโฟลเดอร์)                 lib/prisma.ts   .env.example
```

`prisma/` และ `lib/prisma.ts` ลบได้เพราะเลือกโหมด mock — ถ้าอยากเก็บไว้ต่อยอด
ทีหลัง ให้ย้ายไปเป็น `docs/legacy-schema.prisma` แทนการทิ้ง ตัวโค้ดจะได้ไม่มี
dependency ที่ไม่มีใครเรียก (`@prisma/client` ถอดออกจาก `package.json` ด้วย)

### 1.3 ไฟล์ที่เหลือ

| ไฟล์ | ทำอย่างไร |
| --- | --- |
| `data/elective-courses.json` | **ใช้เป็นวัตถุดิบของ `data/plan-courses.json`** — 12 วิชาในนี้มีชื่อ บริษัท หมวด ผู้สอน ผู้ประสานงาน ครบแล้ว ที่ต้องเพิ่มคือ `availability` (เดิมมีแต่ `sessions` ที่เป็นคำตอบสุดท้าย ไม่ใช่ทางเลือก) เขียนสคริปต์แปลงครั้งเดียวแล้วแก้มือต่อ จากนั้นลบไฟล์เดิม |
| `data/elective-courses.csv` | ลบพร้อม `scripts/export-sheet-csv.mjs` |
| `scripts/ui-audit.js` | อ่านก่อนลบ — ถ้ามีกฎที่ยังใช้ได้ ให้ย้ายเข้า `check-css.mjs` |
| `README.md`, `docs/data-model.md` | เขียนใหม่ใน Phase 6 (`data-model.md` เปลี่ยนเป็นโดเมนใหม่: slot / room / availability / assignment) |
| `next.config.ts`, `tsconfig.json`, `.vercelignore`, `.claude/launch.json` | ไม่ต้องแตะ |

### 1.4 สร้างใหม่

```
data/plan-rooms.json          ห้องเรียนที่ใช้ได้ + ช่วงที่ห้องถูกจองไว้แล้ว
data/plan-courses.json        วิชาที่บริษัทเสนอ + ช่วงที่สะดวกสอน
lib/plan-types.ts             type ทั้งหมดของโดเมนใหม่
lib/slots.ts                  คำศัพท์คาบเรียน (วัน × คาบ) + helper เวลา
lib/plan-data.ts              โหลด/normalize JSON เป็น PlanPayload
lib/scheduler.ts              auto-assign (pure function, ไม่มี React)
lib/conflicts.ts              ตรวจ conflict + อธิบายเหตุผล
lib/use-plan-state.ts         state กลางของแผน (assignment + undo + localStorage)
components/plan-overview.tsx  หน้าภาพรวม
components/week-grid.tsx      ตารางสัปดาห์ (ใช้ซ้ำทั้งภาพรวมและรายห้อง)
components/slot-cell.tsx      ช่องหนึ่งช่องในตาราง (ว่าง / มีวิชา / ชน)
components/course-chip.tsx    การ์ดวิชาในช่อง มีปุ่มล็อก-ย้าย-เอาออก
components/assign-dialog.tsx  dialog เลือกวิชาลง slot
components/room-list.tsx      หน้ารายชื่อห้อง
components/room-schedule.tsx  ตารางสอนของห้องเดียว
components/availability-editor.tsx  grid เลือกช่วงที่บริษัทสะดวก
components/conflict-panel.tsx panel รายการที่จัดไม่ได้ / ชนกัน
app/page.tsx                  ภาพรวมแผน
app/rooms/page.tsx            รายชื่อห้อง
app/rooms/[roomId]/page.tsx   ตารางสอนของห้องนั้น
app/courses/page.tsx          จัดการวิชา + ช่วงที่สะดวก
scripts/check-scheduler.mjs   unit check ของอัลกอริทึม
```

---

## 2. Data model

### 2.1 คาบเรียน — `lib/slots.ts`

หน่วยพื้นฐานคือ **คาบมาตรฐาน** วัน × ช่วง เพราะบริษัทสื่อสารกันด้วยคำว่า
"พุธเช้า" "ศุกร์เย็น" ไม่ใช่ "09:00–12:00" การเก็บเป็นคาบทำให้เทียบความ
สะดวกของบริษัทกับช่องในตารางได้ตรง ๆ โดยไม่ต้อง parse เวลา

```ts
export type DayKey = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
export type PeriodKey = "AM" | "PM" | "EVE";
export type SlotId = `${DayKey}_${PeriodKey}`;   // "WED_AM"

export const PERIODS: Record<PeriodKey, { label: string; start: string; end: string }> = {
  AM:  { label: "เช้า", start: "09:00", end: "12:00" },
  PM:  { label: "บ่าย", start: "13:00", end: "16:00" },
  EVE: { label: "เย็น", start: "16:00", end: "19:00" },
};
```

ตารางมาตรฐาน = **จันทร์–เสาร์ × 3 คาบ = 18 ช่องต่อห้อง** (เสาร์ใช้จริง ไม่ต้องปิด)

**คาบบ่ายกับคาบเย็นชนขอบกันที่ 16:00** — บ่ายจบ 16:00 เย็นเริ่ม 16:00 พอดี
ไม่มีช่วงพัก ดังนั้นการตรวจชนต้องใช้ช่วงแบบ **half-open `[start, end)`**
เท่านั้น ถ้าเผลอเขียนเป็น `[start, end]` (`startA <= endB && startB <= endA`)
วิชาบ่ายกับวิชาเย็นในห้องเดียวกันจะถูกมองว่าชนกันทุกคู่ ทั้งที่ต่อกันพอดี —
ใส่เคสนี้ใน `check-scheduler.mjs` ตรง ๆ เพราะเป็นบั๊กที่มองไม่เห็นจากหน้าจอ

**เวลาจริงในคาบ** — `Assignment` เก็บ `startTime`/`endTime` ของตัวเองได้ ค่า
เริ่มต้นคือค่าของคาบ แต่วิชาที่สอน 13:00–17:00 ก็ยังนับว่าอยู่ในคาบ `PM`
กติกา:

- **การวาง / auto-assign / การแสดงผลตาราง** ใช้ระดับคาบ
- **การตรวจชน** ใช้เวลาจริง `[startTime, endTime)` เทียบกันภายในวันเดียวกัน
  ดังนั้นวิชา 13:00–16:00 (PM) กับ 16:00–19:00 (EVE) ในห้องเดียวกันไม่ชน แต่
  12:00–15:00 (PM) กับ 09:00–12:30 (AM) ชน — ตรวจแบบคาบล้วนจะจับไม่ได้
- ถ้าเวลาจริงของวิชาล้นออกนอกกรอบคาบ ให้ขึ้น warning `SPILLS_PERIOD`
  ไม่ใช่ error เพราะเป็นเรื่องปกติที่ยอมรับได้ถ้าไม่ชนใคร

### 2.2 Type หลัก — `lib/plan-types.ts`

```ts
export type PlanCourse = {
  id: string;
  courseCode: string;
  title: string;
  category: string;              // หมวด เช่น "ปัญญาประดิษฐ์และข้อมูล"
  provider: string;              // บริษัทที่เสนอ เช่น "Soft Square"
  instructor: string;
  coordinator: { name: string; email: string | null; lineId: string | null } | null;
  deliveryMode: "ON_SITE" | "HYBRID" | "ONLINE";

  /** ช่วงที่บริษัทแจ้งว่าสะดวกสอน — หัวใจของทั้งระบบ */
  availability: SlotId[];
  /** ต้องได้กี่คาบต่อสัปดาห์ (ปกติ 1, บางวิชา 2) */
  sessionsPerWeek: number;
  /** ความต้องการห้อง */
  roomNeeds: { minSeats: number; kind: RoomKind | null; features: string[] };

  capacity: number;
  weeks: number;
  notes: string | null;
};

// หมายเหตุ (หลังสร้างจริง): RoomKind ถูกตัดออกทั้งหมด — ดูข้อ 11
export type RoomKind = "LECTURE" | "LAB" | "HALL";

/** ใครเป็นเจ้าของห้อง — ตัวนี้กำหนดลำดับการเลือกห้อง ดูข้อ 2.4 */
export type RoomTier =
  | "READY"              // จุฬาพัฒน์ — ภาคใช้ได้เลย
  | "NEEDS_APPROVAL";    // ตึก 3 / ตึก 4 ของคณะวิศวะ — ต้องยื่นเรื่องก่อน

export type PlanRoom = {
  id: string;
  name: string;                  // "จุฬาพัฒน์ 4 ห้อง A ชั้น 3"
  building: string;              // "จุฬาพัฒน์ 4"
  floor: string;                 // "3"
  seats: number;
  /** true = ตัวเลขนี้เดาจากวิชาที่เคยใช้ห้อง ยังไม่ได้ยืนยันกับผู้ดูแลอาคาร */
  seatsIsEstimated: boolean;
  tier: RoomTier;
  kind: RoomKind;
  features: string[];            // ["projector", "recording"]
  /** คาบที่ห้องถูกใช้โดยวิชาอื่นอยู่แล้ว จัดวิชาเลือกลงไม่ได้ */
  blockedSlots: Array<{ slotId: SlotId; reason: string }>;
};

export type Assignment = {
  id: string;
  courseId: string;
  slotId: SlotId;
  roomId: string | null;         // null = ONLINE ไม่ต้องใช้ห้อง
  startTime: string;             // "09:00" — ค่าเริ่มต้นจากคาบ แก้ได้
  endTime: string;
  /** ผู้ใช้ยืนยันแล้ว — auto-assign ห้ามแตะ */
  locked: boolean;
  source: "AUTO" | "MANUAL";
};

export type PlanPayload = {
  dataset: string;
  lastUpdated: string;
  timezone: "Asia/Bangkok";
  isMock: boolean;
  courses: PlanCourse[];
  rooms: PlanRoom[];
  assignments: Assignment[];     // แผนที่บันทึกไว้ (เริ่มต้นว่าง)
};
```

**ทำไม `availability` เป็น array ของ `SlotId` ไม่ใช่ข้อความ** — ข้อมูลเดิม
ในโปรเจกต์เก็บตารางสอนเป็น `sessions[]` ที่ระบุวัน-เวลา-ห้องเจาะจงไปแล้ว ซึ่ง
ตอบได้แค่ "สอนเมื่อไร" แต่ตอบไม่ได้ว่า "ย้ายไปไหนได้บ้าง" ระบบวางแผนต้องรู้
ทางเลือกทั้งหมด ไม่ใช่คำตอบสุดท้าย

**ทำไม `Assignment` แยกจาก `PlanCourse`** — วิชาเป็นข้อเท็จจริงจากบริษัท ส่วน
assignment เป็นการตัดสินใจของภาค การแยกทำให้กด "จัดใหม่" แล้วโยน assignment
ทิ้งได้โดยข้อมูลวิชาไม่แตะ และทำให้ `useLocalDataset` เก็บเฉพาะสิ่งที่ผู้ใช้
ตัดสินใจจริง ๆ ลง `localStorage`

### 2.3 ห้องเรียน — `data/plan-rooms.json`

ห้องที่ใช้ได้จริง 9 ห้อง แบ่งเป็นสองชั้น (tier) ตามความยากในการขอใช้:

**Tier `READY` — จุฬาพัฒน์ (ใช้ได้เลย)**

| id | ห้อง | ชั้น | ที่นั่ง | หมายเหตุ |
| --- | --- | --- | --- | --- |
| `cp4-1f` | จุฬาพัฒน์ 4 ชั้น 1 | 1 | 64 | |
| `cp4-3f-hall` | จุฬาพัฒน์ 4 โถงกลาง ชั้น 3 | 3 | 236 | `kind: HALL` |
| `cp4-3f-a` | จุฬาพัฒน์ 4 ห้อง A ชั้น 3 | 3 | 64 | |
| `cp4-3f-b` | จุฬาพัฒน์ 4 ห้อง B ชั้น 3 | 3 | 30 | ห้องเล็กสุด |
| `cp5-203` | จุฬาพัฒน์ 5 ห้อง 203 | 2 | 58 | |
| `cp5-206` | จุฬาพัฒน์ 5 ห้อง 206 | 2 | 36 | |

**Tier `NEEDS_APPROVAL` — อาคารคณะวิศวะ (ต้องยื่นเรื่องขอใช้ก่อน)**

| id | ห้อง | ที่นั่ง | หมายเหตุ |
| --- | --- | --- | --- |
| `eng4-17-02` | ตึก 4 ชั้น 17 ห้อง 17-02 | ~40 | `seatsIsEstimated: true` |
| `eng4-18-15` | ตึก 4 ชั้น 18 ห้อง 18-15 | ~30 | `seatsIsEstimated: true` |
| `eng3-405` | ตึก 3 ชั้น 4 ห้อง 405 | ~50 | `seatsIsEstimated: true` |

**ความจุที่ยังไม่ยืนยัน** — สามห้องท้ายไม่มีตัวเลขทางการ ที่ใส่ไว้คือจำนวนที่
เห็นจากวิชาที่เคยใช้ห้องนั้น ซึ่งเป็น *ขอบล่าง* ของความจุจริง ไม่ใช่ความจุจริง
`seatsIsEstimated: true` ทำให้ UI แสดงเป็น "~40 ที่นั่ง" พร้อมไอคอน และทำให้
scheduler ไม่เอาห้องพวกนี้ไปรับวิชาที่ต้องการที่นั่งเกินตัวเลขที่เห็น — ถ้า
ปล่อยให้ดูเหมือนตัวเลขยืนยันแล้ว จะมีคนไปจัดวิชา 45 คนลงห้องที่จุได้จริง 38

**เรื่องที่ยังไม่รู้และควรถามก่อน Phase 1** — ทั้ง 9 ห้องยังไม่มีข้อมูลว่าห้อง
ไหนเป็นห้องปฏิบัติการ มีคอมพิวเตอร์ให้ หรือมีอุปกรณ์บันทึกวิดีโอสำหรับสอน
HYBRID ตอนนี้ให้ตั้ง `kind: "LECTURE"` และ `features: []` ไว้ทั้งหมด (ยกเว้น
โถงกลางที่เป็น `HALL`) แล้วเก็บ field ไว้ในโครงสร้าง เพราะข้อมูลนี้จะมาทีหลัง
แน่ ๆ และการเพิ่ม field ทีหลังแพงกว่าการปล่อยให้ว่างไว้

**โถงกลาง 236 ที่นั่ง** จะแทบไม่ถูกเลือกโดยอัตโนมัติ เพราะ soft constraint
หักคะแนนห้องที่ใหญ่เกินความจำเป็น — ซึ่งถูกแล้ว เก็บไว้ให้วิชาที่รับเยอะจริง
หรือคาบปฐมนิเทศ ถ้าอยากกันไว้เด็ดขาด ใส่ `blockedSlots` ครบทุกคาบแล้วปลดเป็น
คาบ ๆ ไป

### 2.4 ลำดับการเลือกห้อง: จุฬาพัฒน์ก่อนเสมอ

ห้องในตึก 3 / ตึก 4 เป็นของคณะวิศวะ ต้องดำเนินเรื่องหลายขั้นตอนกว่าจะใช้ได้
จึงต้องใช้เมื่อ **จุฬาพัฒน์ไม่พอจริง ๆ** เท่านั้น

วิธีที่ *ไม่* ควรใช้คือให้คะแนน soft constraint กับห้องจุฬาพัฒน์ เพราะคะแนน
ถูกโหวตแพ้ได้ — กติกา "บริษัทเดียวกันได้วันเดียวกัน" (+40) อาจดันวิชาหนึ่งเข้า
ตึก 4 ทั้งที่จุฬาพัฒน์ยังว่าง แล้วจะไม่มีใครอธิบายได้ว่าทำไม

**ใช้การจัดสองรอบแทน:**

```ts
// รอบที่ 1 — เฉพาะห้องจุฬาพัฒน์
const first = autoAssign({ courses, rooms: rooms.filter(r => r.tier === "READY"), locked });

// รอบที่ 2 — เฉพาะวิชาที่รอบแรกจัดไม่ลง จึงเปิดห้องคณะวิศวะให้
const second = autoAssign({
  courses: courses.filter(c => first.unassigned.some(u => u.courseId === c.id)),
  rooms,
  locked: [...locked, ...first.assignments],
});
```

การรับประกันจึงเป็นแบบเด็ดขาด: **ไม่มีวิชาใดถูกจัดลงห้องคณะวิศวะ ถ้าจุฬาพัฒน์
ยังรับไหว** และอธิบายได้ทุกกรณีว่าทำไมวิชานี้ถึงต้องไปตึก 4

ทุก assignment ที่ตกมาอยู่ tier `NEEDS_APPROVAL` ต้องเข้าถังงาน `WAITING`
(รอข้อมูล) ของ `QueueFilterGroup` โดยอัตโนมัติ ด้วยข้อความว่า
*"ต้องยื่นเรื่องขอใช้ห้องกับคณะวิศวะ"* — งานธุรการที่ระบบรู้ว่าเกิดขึ้นแล้วไม่
บอกใคร คือเรื่องที่จะไปโผล่เอาตอนสัปดาห์แรกของเทอม

ในหน้า `/rooms` แยกสองกลุ่มให้ชัด: จุฬาพัฒน์ขึ้นก่อน ส่วนกลุ่มคณะวิศวะอยู่ใต้
หัวข้อ *"ต้องขออนุมัติก่อนใช้"* พร้อม `.status-pill.tone-orange`

**ความจุรวมของระบบ** — จุฬาพัฒน์ 6 ห้อง × 18 คาบ = **108 คาบ-ห้อง** สำหรับวิชา
ราว 12 ตัว แปลว่าห้องไม่ใช่คอขวด คอขวดจริงคือ *ช่วงที่บริษัทสะดวกไปกระจุกกัน*
(ทุกบริษัทอยากได้พุธเช้า) ซึ่งเป็นเหตุผลที่การเรียงลำดับแบบ most-constrained-first
ในข้อ 3.1 สำคัญกว่าการเลือกห้องมาก

### 2.5 ตัวอย่างข้อมูล — `data/plan-courses.json`

```json
{
  "id": "plan-course-21105801",
  "courseCode": "21105801",
  "title": "SW Dev for CMMI Standard",
  "category": "วิศวกรรมซอฟต์แวร์",
  "provider": "Soft Square",
  "instructor": "อาจารย์กานต์",
  "deliveryMode": "ON_SITE",
  "availability": ["WED_AM"],
  "sessionsPerWeek": 1,
  "roomNeeds": { "minSeats": 40, "kind": "LECTURE", "features": ["projector"] },
  "capacity": 40, "weeks": 10,
  "notes": "บริษัทแจ้งว่าสะดวกพุธเช้าช่วงเดียว"
}
```

ชุด seed ควรมีเคสที่ทำให้เห็นค่าของระบบ อย่างน้อย:

1. วิชาที่สะดวกช่วงเดียว (ต้องล็อกให้ก่อน)
2. วิชาที่สะดวกทับกับข้อ 1 แต่มีช่วงสำรอง (ต้องถูกปัดไป)
3. วิชาที่รับ 60 คน — ลงได้แค่ 3 ห้องในจุฬาพัฒน์ (64/64/236 ที่นั่ง)
4. วิชาที่ต้องได้ 2 คาบ/สัปดาห์
5. วิชา ONLINE ที่ไม่กินห้อง
6. วิชาที่จัดไม่ได้จริง ๆ เพื่อทดสอบ `explainFailure`
7. ชุดวิชาที่บีบให้จุฬาพัฒน์เต็มในคาบหนึ่ง เพื่อทดสอบว่ารอบที่สองเปิดห้องคณะ
   วิศวะให้จริง และวิชานั้นขึ้นถังงาน `WAITING` ว่าต้องยื่นเรื่องขอใช้ห้อง

---

## 3. อัลกอริทึมจัดตาราง — `lib/scheduler.ts`

เขียนเป็น **pure function** ไม่มี React ไม่มี `Date.now()` ไม่มี `Math.random()`
รับ input เดิมต้องได้ผลเดิมเสมอ เพื่อให้ทดสอบด้วย node script ได้และเพื่อให้
ผู้ใช้ไม่เจอตารางเปลี่ยนเองเมื่อกดปุ่มเดิมซ้ำ

```ts
export function autoAssign(input: {
  courses: PlanCourse[];
  rooms: PlanRoom[];
  locked: Assignment[];     // ของที่ผู้ใช้ล็อกไว้ — ห้ามแตะ
}): {
  assignments: Assignment[];
  unassigned: Array<{ courseId: string; reason: FailureReason }>;
};
```

### 3.1 ลำดับขั้น

1. **วาง locked ก่อน** ยึดพื้นที่ในตารางจาก assignment ที่ผู้ใช้ล็อก
2. **เรียงวิชาแบบ most-constrained-first (MRV)** — วิชาที่มีทางเลือกน้อยที่สุด
   จัดก่อน คำนวณ "จำนวนทางเลือกที่ยังเป็นไปได้" = จำนวนคู่ (slot × ห้อง) ที่
   ผ่าน hard constraint ณ ตอนนั้น tie-break ตามลำดับ: ต้องการห้องเฉพาะทาง →
   ต้องได้หลายคาบ → capacity มาก → `courseCode` (ทำให้ผลลัพธ์ deterministic)

   นี่คือส่วนที่ตอบโจทย์ตั้งต้นโดยตรง: Company A สะดวกพุธเช้าอย่างเดียว
   (ทางเลือก = 1) จะถูกจัดก่อน Company B ที่สะดวกพุธเช้า+ศุกร์เย็น
   (ทางเลือก = 2) เสมอ พอถึงคิว B พุธเช้าเต็มแล้ว B จึงตกไปศุกร์เย็นเอง
   โดยไม่ต้องเขียนกฎเฉพาะกิจ

3. **ให้คะแนนทุกคู่ (slot, room) ที่ผ่าน hard constraint** แล้วเลือกคะแนนสูงสุด
4. **Limited backtracking** ถ้าวิชาหนึ่งไม่มีที่ลงเลย ลองย้ายวิชาที่กันอยู่
   (เฉพาะที่ไม่ locked) ไปทางเลือกสำรองของมัน ลึกไม่เกิน 2 ชั้น ถ้ายังไม่ได้
   ให้เข้า `unassigned` พร้อมเหตุผล — ห้ามวางทับแล้วปล่อยให้ชน
5. **วิชาที่ต้องได้หลายคาบ** จัดทีละคาบ โดยคาบที่สองต้องไม่อยู่วันเดียวกับ
   คาบแรก (soft rule ปรับได้ใน `SCHEDULER_WEIGHTS`)

`autoAssign` เองไม่รู้จักเรื่องตึก — ตัวที่ห่ออีกชั้นคือ `planSchedule()` ซึ่ง
เรียก `autoAssign` สองรอบตามข้อ 2.4 (จุฬาพัฒน์ก่อน แล้วค่อยเปิดห้องคณะวิศวะ)
UI เรียกเฉพาะ `planSchedule()` เท่านั้น

### 3.2 Hard constraints (ผิดข้อใดข้อหนึ่ง = วางไม่ได้)

| รหัส | เงื่อนไข |
| --- | --- |
| `OUTSIDE_AVAILABILITY` | `slotId` ไม่อยู่ใน `course.availability` |
| `ROOM_BLOCKED` | คาบนั้นห้องถูกจองไว้แล้วใน `blockedSlots` |
| `ROOM_DOUBLE_BOOKED` | ห้องเดียวกัน เวลาจริงคาบเกี่ยวกับวิชาอื่น |
| `ROOM_TOO_SMALL` | `room.seats < course.roomNeeds.minSeats` |
| `ROOM_KIND_MISMATCH` | ต้องการ `LAB` แต่ห้องเป็น `LECTURE` |
| `ROOM_MISSING_FEATURE` | ขาดอุปกรณ์ที่ระบุ (เช่น HYBRID ต้องมี `recording`) |
| `INSTRUCTOR_BUSY` | ผู้สอนคนเดียวกันมีคาบทับอยู่แล้ว |
| `PROVIDER_BUSY` | บริษัทเดียวกันส่งคนได้ทีมเดียวต่อคาบ (เปิด/ปิดได้ด้วย flag) |

### 3.3 Soft constraints (คะแนน — ยิ่งสูงยิ่งดี)

| น้ำหนัก | กติกา | เหตุผล |
| --- | --- | --- |
| +40 | บริษัทเดียวกันได้วันเดียวกัน | วิทยากรเดินทางมาครั้งเดียวสอนได้หลายวิชา |
| +25 | คาบเช้า/บ่าย มากกว่าคาบเย็น | คาบเย็นเป็นทางเลือกสุดท้าย นิสิตมาน้อย |
| +20 | ไม่ชนกับวิชาในหมวดเดียวกัน | ถ้าชน นิสิตที่สนใจหมวดนั้นเลือกได้แค่ตัวเดียว |
| +15 | ขนาดห้องพอดี (เหลือที่นั่งน้อยกว่า 30%) | กันวิชา 30 คนไปกินห้อง 120 ที่นั่ง |
| +10 | ภาระต่อวันสมดุล (ไม่กระจุกวันเดียว) | ห้องและเจ้าหน้าที่รับไหว |
| −30 | ใช้ห้องพิเศษ (`HALL` / `LAB`) ทั้งที่วิชาไม่ได้ขอ | เก็บโถงกลาง 236 ที่นั่งไว้ให้วิชาที่รับเยอะจริง |


> **ลำดับตึกไม่ได้อยู่ในตารางนี้โดยตั้งใจ** — "จุฬาพัฒน์ก่อน" ทำด้วยการจัด
> สองรอบตามข้อ 2.4 ไม่ใช่ด้วยคะแนน เพราะคะแนนถูกกติกาอื่นโหวตแพ้ได้

น้ำหนักทั้งหมดอยู่ใน `export const SCHEDULER_WEIGHTS` ที่เดียว ปรับได้โดยไม่
ต้องแก้ logic และเป็นสิ่งที่ต้องอธิบายได้เมื่อผู้ใช้ถามว่า "ทำไมมันจัดแบบนี้"

### 3.4 อธิบายเมื่อจัดไม่ได้ — `explainFailure()`

จุดที่ระบบจัดตารางส่วนใหญ่ล้มเหลวคือขึ้นว่า "ไม่สามารถจัดได้" แล้วจบ ผู้ใช้
ไม่รู้ว่าต้องไปแก้อะไร ฟังก์ชันนี้ต้องคืนประโยคที่ชี้เป้าได้:

> **Cyber Defense Lab — Secure Software & Threat Modeling** (รับ 60 คน) จัดไม่ได้
> - **พุธเช้า:** ห้องจุฬาพัฒน์ที่จุ 60 คนได้มี 3 ห้อง — จุฬาพัฒน์ 4 ชั้น 1 และ
>   ห้อง A ชั้น 3 ถูกใช้แล้ว ส่วนโถงกลางถูกกันไว้ทั้งคาบ
> - **ศุกร์เย็น:** บริษัทสะดวก แต่ทุกห้องที่จุ 60 คนได้ถูกใช้หมด
>   (ห้อง B ชั้น 3 จุ 30 · ห้อง 206 จุ 36 · ห้อง 203 จุ 58 — เล็กเกินไปทั้งหมด)
> - **ทางออกที่เป็นไปได้:** ปลดล็อกโถงกลางคาบพุธเช้า · ปลดล็อก
>   *AI Service Development* แล้วให้ระบบจัดใหม่ · ขอช่วงเพิ่มจากบริษัท ·
>   ลดจำนวนที่รับเหลือ 58 เพื่อให้ลงห้อง 203 ได้

โครงสร้าง: เก็บ `FailureReason = { perSlot: Array<{ slotId, blockers: HardConstraintCode[], detail: string }>, suggestions: Suggestion[] }`
แล้วให้ `conflict-panel.tsx` เรนเดอร์ ปุ่ม suggestion กดแล้วทำงานได้จริง
(ปลดล็อกวิชาที่ระบุแล้วรัน `autoAssign` ใหม่)

### 3.5 ตรวจ conflict ของแผนที่แก้มือ — `lib/conflicts.ts`

แยกจาก `scheduler.ts` เพราะทำงานคนละจังหวะ: scheduler ทำงานตอนกดปุ่ม ส่วน
conflict detector ทำงานทุกครั้งที่ state เปลี่ยน (ผู้ใช้ลากวิชา, แก้เวลา,
แก้ availability) ต้องเร็วและต้องไม่บล็อกการวาง

```ts
export function detectConflicts(state: PlanState): Conflict[];
export type Conflict = {
  code: HardConstraintCode | "SPILLS_PERIOD" | "UNDER_SCHEDULED" | "CATEGORY_CLASH";
  severity: "BLOCKED" | "WAITING" | "IN_PROGRESS";   // ตรงกับ QueueKind เดิม
  assignmentIds: string[];
  message: string;
};
```

**การวางที่ผิดกติกาต้องวางได้ แต่ต้องเห็นชัดว่าผิด** — ผู้ใช้อาจรู้เรื่องที่
ระบบไม่รู้ (บริษัทเพิ่งโทรมาบอกว่าสะดวกเพิ่ม) ระบบที่ห้ามวางเลยจะถูกเลิกใช้
ช่องที่มีปัญหาแสดงด้วย `.slot-cell.is-conflict` + `.tone-red` และนับเข้า KPI
สีแดงใบแรก

`severity` แม็ปเข้ากับ `QueueKind` เดิมตรง ๆ เพื่อให้ `QueueFilterGroup` และ
`PriorityKpi` ที่มีอยู่แล้วใช้ได้โดยไม่ต้องแก้:

- `BLOCKED` (ติดปัญหา) — ชนจริง เปิดสอนไม่ได้: ห้องซ้ำ ผู้สอนซ้ำ
- `WAITING` (รอข้อมูล) — วิชาที่ยังไม่มี availability หรือยังไม่มีห้องที่รองรับ
- `IN_PROGRESS` (กำลังทำ) — จัดแล้วแต่ยังไม่ล็อก / เวลาล้นคาบ

---

## 4. หน้าเว็บ

Navigation ใหม่ใน `components/app-nav.tsx`:

```ts
const sections = [
  { href: "/", label: "ภาพรวมแผน" },
  { href: "/rooms", label: "ห้องเรียน" },
  { href: "/courses", label: "วิชาและช่วงที่สะดวก" },
];
```

### 4.1 `/` — ภาพรวมแผน (`plan-overview.tsx`)

โครงหน้าเหมือน dashboard เดิมทุกประการ ใช้ class เดิมทั้งหมด:

```
.topbar        แถบ navy + AppNav + วันที่อัปเดต + .local-edit-note (มีแผนที่แก้ไว้ / ปุ่มรีเซ็ต)
.intro-row     หัวเรื่อง + .scope-chip (ภาคต้น 2569 · จ.–ส. 18 คาบ · 9 ห้อง)
.kpi-grid      5 ใบ
.control-panel ปุ่มจัดอัตโนมัติ + .filters
.follow-up-panel  รายการที่ต้องแก้ (QueueFilterGroup + .follow-up-item)
.panel         ตารางรวมทั้งสัปดาห์ (WeekGrid)
.table-panel   ตารางรายวิชา + Pager
```

**KPI 5 ใบ — ลำดับสีต้องเป็น `red → blue → green → purple → orange`**
`scripts/check-consistency.mjs` เทียบลำดับ `className="kpi-card <tone>"`
ข้ามหน้า ถ้าเรียงไม่ตรงกันจะ fail:

| ลำดับ | โทน | ตัวเลข |
| --- | --- | --- |
| 1 | `PriorityKpi` (แดง) | วิชาที่ยังจัดไม่ได้ / มี conflict |
| 2 | blue | จัดแล้ว x / y วิชา (มี `.kpi-progress`) |
| 3 | green | คาบที่ล็อกยืนยันแล้ว |
| 4 | purple | อัตราการใช้ห้อง % |
| 5 | orange | คาบที่ต้องยื่นเรื่องขอใช้ห้องคณะวิศวะ |

**ปุ่มจัดอัตโนมัติ** อยู่ใน `.control-heading` เป็น `.primary-button`
ข้าง ๆ มี `.secondary-button` "ล้างเฉพาะที่ยังไม่ล็อก" และ `.text-button`
"ล้างทั้งหมด" ทุกการทำงานยิง `StatusToast` พร้อมปุ่ม undo ที่มีอยู่แล้ว —
การจัดใหม่ทับของเดิมโดยกู้คืนไม่ได้เป็นสิ่งที่จะทำให้ไม่มีใครกล้ากดปุ่มนี้

**WeekGrid ในหน้าภาพรวม** แสดงทุกห้องรวมกัน แต่ละช่องซ้อนได้หลายวิชา (คนละห้อง)
เป็น chip เล็ก ๆ กดแล้วเปิด dialog รายละเอียด

### 4.2 `/rooms` — รายชื่อห้อง (`room-list.tsx`)

ตามที่ตั้งใจไว้: ลิสต์ห้องที่ใช้ได้ กดเข้าไปเป็นหน้าตารางสอน

การ์ดห้องใช้ `.kpi-card-button` (มี hover lift + focus ring อยู่แล้ว):

```
จุฬาพัฒน์ 4 ห้อง A ชั้น 3               [LECTURE]
จุฬาพัฒน์ 4 · ชั้น 3 · 64 ที่นั่ง
ใช้ไปแล้ว 4 / 18 คาบ
[▓▓▓░░░░░░░░░░░░░░]  .mini-progress
ว่าง: จ.บ่าย · อ.เช้า · พฤ.ทั้งวัน · ศ.เย็น · ส.ทั้งวัน
```

**แบ่งสองกลุ่มตามข้อ 2.4** — จุฬาพัฒน์ 6 ห้องขึ้นก่อนใต้หัวข้อ *"ใช้ได้ทันที"*
แล้วตามด้วย *"ต้องขออนุมัติก่อนใช้"* สำหรับ 3 ห้องของคณะวิศวะ ซึ่งการ์ดมี
`.status-pill.tone-orange` และความจุแสดงเป็น `~40 ที่นั่ง` พร้อม `.note-icon`
บอกว่ายังไม่ได้ยืนยันตัวเลข

พร้อม `.filters` กรองตามอาคาร / ความจุขั้นต่ำ / "เฉพาะห้องที่ใช้ได้ทันที" /
"เฉพาะห้องที่ยังมีคาบว่าง"

### 4.3 `/rooms/[roomId]` — ตารางสอนของห้อง (`room-schedule.tsx`)

หัวใจของการแก้มือ ตาราง 6 วัน × 3 คาบ ของห้องเดียว

| สถานะช่อง | หน้าตา | การกระทำ |
| --- | --- | --- |
| ว่าง | `.slot-cell.is-empty` เส้นประจาง มีปุ่ม `＋ เพิ่มวิชา` | เปิด `AssignDialog` |
| ห้องถูกจองไว้ | `.slot-cell.is-blocked` พื้นเทาลาย + เหตุผล | กดไม่ได้ |
| มีวิชา | `.course-chip` ชื่อวิชา + บริษัท + เวลาจริง + ปุ่ม 🔒 / ✕ | ลากย้าย / ล็อก / เอาออก |
| ชน | `.slot-cell.is-conflict` ขอบแดง + `.status-pill.tone-red` | กดดูเหตุผล |

**`AssignDialog`** — เปิดจากช่องว่าง ใช้ `.course-dialog` เดิม รายการวิชาแบ่ง 2 กลุ่ม:

1. **บริษัทสะดวกคาบนี้** — เรียงตามคะแนน soft constraint พร้อมเหตุผลสั้น ๆ
   ("บริษัทเดียวกับที่สอนพุธบ่ายอยู่แล้ว")
2. **บริษัทไม่ได้แจ้งว่าสะดวก** — พับไว้ ต้องกดเปิด มี `.status-pill.tone-orange`
   เตือน และวางแล้วจะเกิด conflict `OUTSIDE_AVAILABILITY` ทันที

วิชาที่ผิด hard constraint เรื่องห้อง (ห้องเล็กไป / ผิดชนิด) แสดงพร้อมเหตุผล
แต่ **disable ไม่ได้ทั้งหมด** — แสดงเหตุผลแล้วให้เลือกได้ ถ้าเลือกจะขึ้น conflict

**Drag & drop** ใช้ HTML5 native (`draggable`, `onDragStart/onDragOver/onDrop`)
และต้องมีทางเลือกที่ใช้คีย์บอร์ดได้เสมอ: ปุ่ม "ย้าย" บน chip → เข้าโหมดเลือก
ปลายทาง → ทุกช่องกลายเป็นปุ่ม → เลือกด้วย Tab/Enter โปรเจกต์นี้ใส่ใจ a11y ทั้ง
ระบบ (`focus-visible` ทุกตัว, `--tap-min: 44px`, `ResultAnnouncer` แบบ `aria-live`)
drag-only จะเป็นจุดเดียวที่หลุดมาตรฐาน — และใช้บนมือถือไม่ได้ด้วย

ทุกการย้ายประกาศผ่าน `ResultAnnouncer` และเด้ง `StatusToast` พร้อม undo

### 4.4 `/courses` — วิชาและช่วงที่สะดวก (`availability-editor.tsx`)

ตารางวิชา + dialog แก้ไข ซึ่งภายในมี grid 6×3 ให้ติ๊กว่าบริษัทสะดวกคาบไหน
ตั้ง `sessionsPerWeek` และความต้องการห้อง

นี่คือหน้าที่ทำให้ระบบใช้งานได้จริง เพราะข้อมูลนี้เปลี่ยนทุกครั้งที่ประสานงาน
กับบริษัท ถ้าแก้ไม่ได้ในเว็บ ทุกคนจะกลับไปใช้ Google Sheet

---

## 5. State และการบันทึก — `lib/use-plan-state.ts`

ต่อยอด `useLocalDataset` เดิม (ซึ่งเก็บเฉพาะแถวที่เปลี่ยน และมี `reset`) แต่
สิ่งที่บันทึกคือ **assignment กับ availability ที่ผู้ใช้แก้** ไม่ใช่ทั้ง dataset

```ts
const STORAGE_KEY = "nextlink.plan.v1";

type StoredPlan = {
  assignments: Assignment[];
  courseOverrides: Record<string, Partial<PlanCourse>>;  // availability ที่แก้เอง
  editedAt: string;
};
```

API ที่ component ใช้:

```ts
const {
  courses, rooms, assignments, conflicts, unassigned,
  runAutoAssign,            // เคารพ locked, ยิง toast + undo
  place(courseId, slotId, roomId),
  move(assignmentId, slotId, roomId),
  remove(assignmentId),
  toggleLock(assignmentId),
  setTime(assignmentId, start, end),
  setAvailability(courseId, slotIds),
  clearUnlocked, resetAll, editedAt,
} = usePlanState(payload);
```

`conflicts` และ `unassigned` คำนวณด้วย `useMemo` จาก state ไม่เก็บลง storage —
สถานะที่ derive ได้แล้วยังเก็บซ้ำคือแหล่งของข้อมูลที่ขัดกันเอง

Undo ทำด้วย snapshot ของ `assignments` ก่อนหน้า (array เล็ก ไม่กี่ KB) เก็บใน
ref ชั้นเดียวพอ — ไม่ต้องทำ undo stack เต็มรูปแบบในเฟสแรก

---

## 6. CSS ที่ต้องเพิ่ม

ต่อท้าย `app/globals.css` เป็นบล็อกใหม่ `/* Schedule plan */` ตาม convention
เดิมของไฟล์: หนึ่ง rule ต่อหนึ่งบรรทัด และคอมเมนต์อธิบาย *ทำไม* ไม่ใช่ *อะไร*

```
.week-grid            grid-template-columns: 72px repeat(6, minmax(0, 1fr))  /* จ.–ส. */
.week-grid-head       หัววัน sticky
.period-label         ป้ายคาบด้านซ้าย
.slot-cell            ช่องพื้นฐาน + สถานะ .is-empty / .is-blocked / .is-conflict / .is-drop-target
.slot-add             ปุ่ม ＋ ในช่องว่าง (min-height: var(--tap-min))
.course-chip          การ์ดวิชาในช่อง + .is-locked
.chip-actions         ปุ่มล็อก/ย้าย/ลบ
.room-card            การ์ดห้องในหน้า /rooms
.availability-grid    grid ติ๊กช่วงที่สะดวก
.conflict-list        รายการปัญหาพร้อมปุ่มทางออก
```

ใช้ token เดิมทั้งหมด (`--ink`, `--muted`, `--line`, `--blue`, `--green`,
`--red`, `--tap-min`, `--focus-ring`) และ `.tone-*` เดิมสำหรับสี pill
**ห้ามเพิ่มสีใหม่** — สีในไฟล์นี้ผ่านการตรวจ contrast มาแล้วทุกตัว

### ข้อห้ามจาก `scripts/check-css.mjs` (จะ fail ทันทีถ้าผิด)

1. ห้าม `max-height: calc(NNvh - NNpx)` — เคยทำให้ปุ่มบันทึกใน dialog กดไม่ได้
   ใช้ `flex` + `min-height: 0` แบบที่ `.course-dialog` ทำอยู่แทน
2. focus ring ต้อง alpha ≥ 0.8 — ใช้ `outline: 3px solid var(--focus-ring)`
3. ห้าม class ซ้ำใน selector เดียว (`.slot-cell.slot-cell`)
4. ห้ามใส่ `overflow: auto` บน `.table-panel` / `.page-content` เพราะจะจับ
   sticky header ของตารางไว้
5. หนึ่ง rule หนึ่งบรรทัด ห้ามมี whitespace ซ้อนหลัง combinator

### ข้อควรระวังเฉพาะของ WeekGrid

ตารางสัปดาห์กว้างเกินจอมือถือแน่นอน ที่ `max-width: 760px` ให้สลับเป็น
**รายการรายวัน** (accordion จันทร์…เสาร์) แบบเดียวกับที่ `.mobile-course-list`
ทำกับตารางเดิม อย่าใช้ scroll แนวนอน — และห้ามลืมซ่อนอีกฝั่งหนึ่ง เพราะบั๊ก
ที่เคยเกิดในไฟล์นี้คือแสดงทั้งตารางและการ์ดพร้อมกัน

---

## 7. Static checks ที่ต้องแก้

`scripts/check-consistency.mjs` **จะพังทันที** หลังลบ dashboard เก่า เพราะ
hardcode ไว้ว่า:

```js
const PAGES = ["elective", "internship", "mou"];
const read = (name) => readFileSync(`components/${name}-dashboard.tsx`, "utf8");
```

ต้องแก้เป็นหน้าใหม่ และ **แยกขอบเขตของแต่ละกฎ** เพราะเดิมทุกกฎใช้ `PAGES`
ชุดเดียว ซึ่งได้ผลตอนที่ทั้ง 3 หน้าเป็น dashboard หน้าตาเดียวกัน แต่โครงใหม่มี
หน้าที่ต่างชนิดกัน — หน้ารายชื่อห้องไม่มีแถว KPI และไม่มีถังงาน การบังคับให้มี
จะกลายเป็นกฎที่ทุกคนหาทางเลี่ยง:

```js
const PAGES  = ["plan-overview", "room-list", "room-schedule", "availability-editor"];
const read   = (name) => readFileSync(`components/${name}.tsx`, "utf8");

// ทุกหน้าต้องใช้ 3 ตัวนี้จริง ๆ — nav, empty state, และการประกาศผลแบบ aria-live
const SHARED = ["AppNav", "EmptyResult", "ResultAnnouncer"];

// ลำดับสี KPI: เทียบกับลำดับที่ประกาศไว้ตรง ๆ แทนการเทียบข้ามหน้า
// เพราะโครงใหม่มีหน้า KPI เดียว และกฎข้ามหน้าที่ตรวจหน้าเดียวไม่ได้ตรวจอะไรเลย
const KPI_TONE_ORDER = ["red", "blue", "green", "purple", "orange"];
```

- กฎ **ลำดับสี KPI** → เปลี่ยนเป็นเทียบ `plan-overview` กับ `KPI_TONE_ORDER`
- กฎ **kicker ซ้ำหัวเรื่อง** → ใช้กับทุกหน้าใน `PAGES` ตามเดิม
- กฎ **shared component** → เหลือ 3 ตัวข้างบน ส่วน `PriorityKpi`,
  `QueueFilterGroup`, `Pager`, `FilterSummary` ตัดออกเพราะหน้าตารางห้องไม่มี
  แถว KPI ไม่มีถังงาน และไม่มีการแบ่งหน้า — กฎที่บังคับสิ่งที่หน้านั้นไม่ควรมี
  จะกลายเป็นกฎที่ทุกคนหาทางเลี่ยง
- กฎ **class กำพร้าใน CSS** → เก็บไว้ทั้งดุ้น เป็นกฎที่มีค่าที่สุดในรอบนี้

กฎ "class ที่ CSS ประกาศแต่ไม่มีใครใช้" ยังใช้ได้ดีและจะช่วยจับซากของ 3
dashboard เก่าที่ลืมลบ — เป็นเหตุผลที่ควรรันมันตั้งแต่ Phase 1 ไม่ใช่ตอนท้าย

เพิ่ม `scripts/check-scheduler.mjs` เข้า `npm run check`:

```json
"check": "tsc --noEmit && npm run check:css && npm run check:pages && npm run check:scheduler"
```

---

## 8. ลำดับงาน

### Phase 0 — เคลียร์พื้นที่ (≈ครึ่งวัน)

- ลบไฟล์ตามข้อ 1.2, ถอด `@prisma/client` + `prisma` ออกจาก `package.json`
- แก้ `components/app-nav.tsx` ให้เหลือ 3 หน้าใหม่, แก้ `app/layout.tsx` metadata
- แก้ `scripts/check-consistency.mjs` ตามข้อ 7
- ทำ `app/page.tsx` เป็น placeholder ที่ยัง build ผ่าน
- **เกณฑ์ผ่าน:** `npm run build` ผ่าน, `npm run check` ผ่าน

### Phase 1 — โดเมนและข้อมูล (≈1 วัน)

- `lib/slots.ts`, `lib/plan-types.ts`, `lib/plan-data.ts`
- `data/plan-rooms.json` (9 ห้องตามข้อ 2.3), `data/plan-courses.json`
  (10–12 วิชา ครอบคลุมเคสทั้ง 7 ในข้อ 2.5)
- **เกณฑ์ผ่าน:** `tsc --noEmit` ผ่าน, ข้อมูลโหลดได้และพิมพ์สรุปได้จาก node

### Phase 2 — เครื่องยนต์จัดตาราง (≈1.5 วัน) ⭐ ทำก่อน UI

- `lib/scheduler.ts`, `lib/conflicts.ts`, `scripts/check-scheduler.mjs`
- เคสที่ต้องผ่าน:
  1. วิชาที่สะดวกคาบเดียวได้คาบนั้นเสมอ ไม่ว่าจะเรียงลำดับ input แบบใด
  2. วิชาที่สะดวกหลายคาบถูกปัดไปคาบสำรองเมื่อคาบแรกเต็ม *(โจทย์ตั้งต้น)*
  3. assignment ที่ `locked` ไม่ถูกย้ายไม่ว่ากรณีใด
  4. รัน `autoAssign` ด้วย input เดิม 2 ครั้ง ได้ผลเหมือนกันทุก byte
  5. วิชา ONLINE ไม่กินห้อง
  6. วิชาที่จัดไม่ได้เข้า `unassigned` พร้อมเหตุผลรายคาบ ไม่ใช่วางทับ
  7. `detectConflicts` จับห้องซ้ำที่เวลาคาบเกี่ยวกันแต่คนละคาบมาตรฐาน
     (12:00–15:00 กับ 09:00–12:30 = ชน)
  8. **ขอบ 16:00** — วิชา 13:00–16:00 กับ 16:00–19:00 ในห้องเดียวกัน **ไม่ชน**
     (เคสนี้จะ fail ทันทีถ้าใช้ช่วงแบบ `[start, end]`)
  9. **จุฬาพัฒน์ก่อน** — ถ้าจุฬาพัฒน์ยังว่าง ต้องไม่มีวิชาใดถูกจัดลงห้องตึก 3/4
  10. เมื่อจุฬาพัฒน์เต็มในคาบหนึ่ง วิชาที่เหลือได้ห้องคณะวิศวะ และถูก mark ว่า
      ต้องขออนุมัติ
- **เกณฑ์ผ่าน:** `npm run check:scheduler` ผ่านทั้ง 10 เคส

  ทำเฟสนี้ก่อน UI เพราะเป็นส่วนเดียวที่มีคำว่า "ถูก/ผิด" ชัดเจน ถ้าเอาไปพันกับ
  React ตั้งแต่แรกจะไม่มีทางรู้ว่าตารางที่ออกมาผิดเพราะอัลกอริทึมหรือเพราะ state

### Phase 3 — หน้าภาพรวมแบบอ่านอย่างเดียว (≈1.5 วัน)

- `lib/use-plan-state.ts` (ยังไม่ต้องมี mutation), `components/week-grid.tsx`,
  `slot-cell.tsx`, `course-chip.tsx`, `conflict-panel.tsx`, `plan-overview.tsx`
- CSS บล็อกใหม่ + responsive
- **เกณฑ์ผ่าน:** เห็นตารางสัปดาห์จากข้อมูล seed, KPI ตรงกับข้อมูลจริง,
  `npm run check` ผ่าน, หน้าตาที่ 1440px / 1050px / 760px / 480px ไม่แตก

### Phase 4 — ห้องเรียนและการแก้มือ (≈2 วัน)

- `app/rooms/page.tsx` + `room-list.tsx`
- `app/rooms/[roomId]/page.tsx` + `room-schedule.tsx` + `assign-dialog.tsx`
- mutation ครบใน `usePlanState` + toast/undo + `ResultAnnouncer`
- drag & drop พร้อมทางเลือกคีย์บอร์ด
- **เกณฑ์ผ่าน:** วาง/ย้าย/ลบ/ล็อกได้ครบ, รีเฟรชแล้วแผนยังอยู่, กด undo กลับได้,
  ทำทุกอย่างด้วยคีย์บอร์ดล้วนได้

### Phase 5 — ปุ่มจัดอัตโนมัติและ availability (≈1 วัน)

- ต่อ `runAutoAssign` เข้าปุ่มใน `.control-panel`
- `app/courses/page.tsx` + `availability-editor.tsx`
- `explainFailure` + ปุ่มทางออกใน `conflict-panel.tsx` ที่กดแล้วทำงานจริง
- **เกณฑ์ผ่าน:** กดจัดอัตโนมัติจากตารางว่างได้แผนที่ไม่มี conflict สำหรับชุด
  seed, ล็อก 2 วิชาแล้วกดซ้ำ ของที่ล็อกไม่ขยับ

### Phase 6 — เก็บงาน (≈1 วัน)

- มือถือ: WeekGrid → รายการรายวัน, ทุกปุ่มถึง 44px
- `app/loading.tsx` ปรับ skeleton ให้ตรงโครงหน้าใหม่
- README + `docs/data-model.md` เขียนใหม่ให้ตรงโดเมนใหม่
- **เกณฑ์ผ่าน:** `npm run check` และ `npm run build` ผ่าน, ไม่มี class กำพร้าใน CSS

**รวมประมาณ 8 วันทำงาน** ตัดได้เร็วสุดถึง Phase 4 ก็ใช้งานได้แล้วแบบแก้มือล้วน

---

## 9. สิ่งที่ยังไม่ทำในรอบนี้ (ตั้งใจตัดออก)

- **Postgres / Prisma** — โครงเดิมมีให้อยู่แล้ว ย้ายทีหลังได้โดยไม่แตะ UI ถ้า
  `lib/plan-data.ts` เป็นชั้นเดียวที่รู้จักแหล่งข้อมูล
- **ผู้ใช้หลายคนพร้อมกัน** — `localStorage` เป็นของเครื่องใครเครื่องมัน ถ้าจะให้
  ทีมงานหลายคนแก้แผนเดียวกันต้องมี backend และเรื่อง conflict resolution ตามมา
- **ตารางเรียนของนิสิตรายคน** — ตอนนี้ตรวจแค่ระดับหมวดวิชา (`CATEGORY_CLASH`)
  ถ้าจะให้แม่นต้องมีข้อมูลการลงทะเบียนจริง
- **ปฏิทินรายสัปดาห์จริง** (สัปดาห์ที่ 1–10, วันหยุด, ชดเชย) — ต้องใช้ `weeks`
  กับ `ScheduleException` แบบในสคีมาเดิม เป็นงานอีกก้อน
- **Export เป็น .xlsx / .ics** — ทำได้ง่ายเมื่อ `Assignment` นิ่งแล้ว

---

## 10. จุดที่น่าจะพลาดได้ง่ายที่สุด

1. **ลืมแก้ `check-consistency.mjs`** → `npm run check` พังหลัง Phase 0 แล้วจะมี
   คนสั่ง `--no-verify` ผ่านไป
2. **ทำ UI ก่อน scheduler** → debug ยากมาก เพราะแยกไม่ออกว่าผิดที่ไหน
3. **ห้าม auto-assign แตะ locked** → ถ้าพลาดข้อนี้ ผู้ใช้จะไม่กล้ากดปุ่มอีกเลย
4. **ตรวจชนด้วยคาบอย่างเดียว** → 12:00–15:00 กับ 09:00–12:30 จะถูกมองว่าไม่ชน
   (ผิด) และถ้าใช้ช่วงแบบปิดท้าย `[start, end]` วิชาบ่ายกับวิชาเย็นจะชนกันหมด
   เพราะคาบต่อกันพอดีที่ 16:00
5. **ห้ามวางเมื่อผิดกติกา** → ผู้ใช้รู้เรื่องที่ระบบไม่รู้ ต้องวางได้แต่ต้องเตือน
6. **drag & drop อย่างเดียว** → ใช้บนมือถือไม่ได้ และหลุดมาตรฐาน a11y ของโปรเจกต์
7. **เพิ่มสีใหม่ใน CSS** → สีในไฟล์เดิมผ่านการตรวจ contrast มาแล้ว ใช้ `.tone-*`


---

## 11. สร้างจริงแล้ว — สิ่งที่ต่างจากแผน

ทั้ง 6 เฟสสร้างเสร็จและผ่าน `npm run check` (tsc + CSS + cross-page + scheduler)
กับ `npm run build` ครบทุกหน้า สิ่งที่ตัดสินใจต่างจากแผนระหว่างทาง:

### 11.1 ประเภทห้องถูกตัดออกทั้งหมด

ทุกวิชาออกแบบให้นิสิตพกคอมมาเอง จึงไม่มีความต่างระหว่างห้องบรรยายกับห้อง
ปฏิบัติการ `RoomKind`, `features` และข้อจำกัด `ROOM_KIND_MISMATCH` /
`ROOM_MISSING_FEATURE` จึงไม่มีอยู่จริงในโค้ด ข้อจำกัดของห้องเหลือแค่จำนวนที่นั่ง
กับคาบที่ถูกกันไว้ — ซึ่งทำให้ทั้ง scheduler และ UI เรียบขึ้นพอสมควร

### 11.2 "จัดแล้วแต่ยังไม่ยืนยัน" ไม่ใช่ conflict

ตอนแรกทำเป็น `NOT_CONFIRMED` ระดับ `IN_PROGRESS` ตามแผน ผลคือหน้าจอที่จัดตาราง
ออกมาสมบูรณ์แบบขึ้นว่า **"รายการที่ต้องดู 13"** — ตัวเลขที่อ่านว่ามีปัญหา 13 อย่าง
ทั้งที่ไม่มีอะไรผิดเลย ตัวนับที่ขึ้นเลขตอนไม่มีอะไรผิด คือตัวนับที่คนเรียนรู้ที่จะ
มองข้าม แล้ววันที่มีอะไรผิดจริงมันก็ไม่มีค่าอีกต่อไป

จำนวนคาบที่ยืนยันแล้วเป็น *ตัวเลข* ไม่ใช่ *ปัญหา* จึงย้ายไปอยู่ใน KPI สีเขียว
และไอคอนกุญแจบนการ์ดวิชาแทน (เห็นได้จากภาพหน้าจอ: หลังกดจัดอัตโนมัติ ตัวเลข
สีแดงเป็น 0 ซึ่งเป็นความจริง)

### 11.3 เพิ่ม `PlanShell` — กรอบหน้าที่ทุกหน้าใช้ร่วมกัน

แผนเดิมให้แต่ละหน้าประกอบ topbar เอง ซึ่งเป็นวิธีเดียวกับที่ทำให้ 3 dashboard
เดิม drift กัน `components/plan-shell.tsx` ถือ topbar + nav + ป้ายแก้ไขในเครื่อง
ไว้ที่เดียว และกฎใน `check-consistency.mjs` เปลี่ยนเป็น "ทุกหน้าต้องใช้
`<PlanShell`" พร้อมกฎคู่กันว่า "PlanShell ต้องเป็นตัวที่ render `<AppNav`"

### 11.4 เพิ่มน้ำหนัก `weekday` ให้ scheduler

ตอนทดสอบกับข้อมูลจริงพบว่ามีวิชาถูกจัดลงเสาร์เช้าทั้งที่อังคารเช้ายังว่าง เพราะ
กฎกระจายภาระต่อวันชอบวันที่ยังโล่ง เสาร์เปิดใช้ก็จริงแต่ไม่ควรถูกเติมก่อนวันธรรมดา
จึงเพิ่ม `weekday: 20` คู่กับ `daytimePeriod: 25` ด้วยเหตุผลเดียวกัน

### 11.5 เทสต์ 12 เคส ไม่ใช่ 10

เพิ่มเคส `explainFailure` เรียกเดี่ยว ๆ ได้ และเคสข้อมูล seed ต้องจัดได้ครบ
ไม่มีวิชาตกค้าง — เคสหลังจับได้ทันทีถ้าใครแก้ข้อมูลตัวอย่างแล้วทำให้จัดไม่ลง

### 11.6 Prisma ย้ายไป `docs/legacy/` ไม่ได้ลบ

`docs/legacy/schema.prisma`, `data-model-v1.md` และ `elective-courses-v1.json`
เก็บไว้อ้างอิงตอนย้ายไป PostgreSQL จริง `@prisma/client` ถอดออกจาก dependency แล้ว

### 11.7 ข้อสังเกตเรื่อง `npm install`

โฟลเดอร์นี้อยู่บน Windows และติดตั้ง dependency ผ่าน mount ช้ามาก (~3 นาทีแล้ว
ยังไม่จบ) ถ้า `node_modules` ยังไม่ครบ ให้รัน `npm install` เองจาก terminal บน
เครื่องโดยตรงหนึ่งครั้ง — การตรวจ tsc / build / screenshot ทั้งหมดในรอบนี้ทำบน
สำเนาในคลาวด์ที่ดิสก์เร็วกว่า

### 11.8 บั๊กของ CSS เดิมที่เจอตอนทำ

`app/globals.css` มีกฎ `.course-dialog > * { flex-direction: column; }` ซึ่งทับ
`.dialog-header { display: flex; justify-content: space-between; }` ทำให้ปุ่มปิด
ไปอยู่ใต้หัวเรื่องแทนที่จะอยู่ขวาสุด แก้แล้วโดยให้เฉพาะ `.dialog-content` เป็นตัว
ที่ flex — เป็นบั๊กที่ติดมาจากรุ่นก่อน ไม่ได้เกิดจากงานรอบนี้
