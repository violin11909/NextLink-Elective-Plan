# ผลการแก้จาก audit

Branch: `fix/planner-audit-findings` เริ่มจาก `be97a4af7c08c5d190ca396f0694f964fe46ecff`

แก้บั๊กที่ยืนยันไว้ทั้ง 14 ประเด็น พร้อมเพิ่ม regression checks ผลต่อไปนี้มาจากการทดสอบในเครื่อง ยังไม่ได้ push, รัน GitHub Actions บน remote หรือ deploy

| ข้อ | ปัญหาเดิม | การแก้และหลักฐาน |
| --- | --- | --- |
| 1 | fallback ดึงตำแหน่งเก่ากลับมาชนผู้สอน | ใช้ผลรอบสองทั้งชุด รักษาคาบล็อก; `check:integrity` |
| 2 | ON_SITE/HYBRID ไปอยู่คอลัมน์ออนไลน์ | command ปฏิเสธห้องว่าง/ห้องที่ไม่มี และ detector แจ้งข้อมูลเก่า; หน้าเว็บ/Excel ใช้คำว่า “ยังไม่มีห้อง”; browser regression |
| 3 | move สร้าง id ซ้ำ ลบครั้งเดียวหายสองคาบ | stable session id และตรวจ course/slot ซ้ำ; integrity และ browser regression |
| 4 | standalone ขาด JS/CSS/fonts | build คัดลอก static/public พร้อม worker chunks; production browser ไม่มี asset response ล้มเหลว |
| 5 | หลายแท็บเขียนทับกัน | shared provider + Web Locks + อ่านล่าสุดก่อน mutation + storage event; ทดสอบการเขียนพร้อมกันและตรวจค่าบนหน้าจอสองแท็บ |
| 6 | dependency advisories | Next.js 15.5.25; overrides PostCSS 8.5.28, Sharp 0.35.4; npm audit ไม่พบ vulnerabilities |
| 7 | storage เต็มแต่แจ้งว่าบันทึกแล้ว | สถานะบันทึกจริง เก็บ draft ที่เขียนไม่สำเร็จ สำรอง/ลองใหม่ได้; browser จำลอง QuotaExceededError |
| 8 | storage เสียทำให้หน้า crash วน | runtime schema boundary และแผงกู้คืนที่ดาวน์โหลดต้นฉบับก่อนเริ่มใหม่; storage/browser regression |
| 9 | provider policy ของ scheduler กับ detector ต่างกัน | ใช้ policy กลาง ค่าเริ่มต้นบริษัทเดียวกันเป็นทีมเดียว; integrity ตรวจ default และ opt-out |
| 10 | placement filter ซ่อนแต่ยังกรอง checklist | ใช้เฉพาะมุมมองตาราง ล้างเมื่อสลับ และเอาออกจาก URL; browser ตรวจ 18 วิชาและ Excel |
| 11 | Join MCV เหลืออักษรตัวแรก | เก็บ draft และตรึงแถวที่กำลังกรอกจน blur; browser พิมพ์ ABC123 ภายใต้ incomplete filter แล้ว reload |
| 12 | URL period ไม่ถูกต้องทำให้ crash | whitelist day/period ก่อน render; browser ตรวจค่าผิดและ Back/Forward |
| 13 | ลบห้องจาก detail แล้ว undo หาย | undo อยู่กับ provider ข้าม route · ภายหลังตามคำขอ ปุ่ม "เลิกทำรายการล่าสุด" บนแถบถูกเอาออก undo จึงอยู่ที่ปุ่มใน toast — ลบจากหน้ารายชื่อห้อง undo ได้ (browser regression) ส่วนลบจาก detail ที่เด้งกลับ /rooms ทันทีจึงย้อนไม่ได้ |
| 14 | KPI ตัวตั้ง/ตัวหารคนละกลุ่ม | นับ distinct READY room/slot ที่ใช้ได้ และ distinct courseIds ของทุก conflict; metrics checks |
| 15 | กระดานค้างหลังการย้ายที่ถูกปฏิเสธ | การ์ดถูกวางลงเสมอไม่ว่าคำสั่งจะผ่านหรือไม่ (การ์ดที่ยังถูกถืออยู่ทำให้ทุกช่องเป็นเป้าวาง คลิกการ์ดใบอื่นจึงถูกกลืนเป็นการวางซ้ำ) · Escape ปล่อยการ์ดได้ · เหตุผลที่ถูกปฏิเสธขึ้นเป็น toast ข้างกระดาน ไม่ใช่เฉพาะแถบบนสุด; browser regression |

## งานปรับปรุงประกอบ

- Storage v3 แยกเทอม มี dataset/seedRevision/revision ตรวจ migration จาก v1/v2 และไม่เขียนทับงานใหม่จากอีกแท็บเมื่อ retry
- สำรอง/นำเข้า JSON (หน้าภาพรวมแผน) และ reset ที่ยืนยันก่อนทำ แถบบันทึกระบุเทอมของแผนปัจจุบันทุกหน้า
- Web Worker สำหรับการค้นหาตาราง พร้อมยกเลิกและ timeout 30 วินาที แผนเดิมอยู่ครบเมื่อยกเลิก
- Archive ตรวจผู้สอนชน คาบซ้ำ รูปแบบการสอนกับห้อง และ metadata ตรงกับ index; seed ปฏิเสธ enum/ตัวเลขผิดแทนการเลือกค่าเริ่มต้นที่อาจทำให้ห้องถูกมองว่า READY
- README และ data model ตรงกับ storage และจำนวนห้องปัจจุบัน แยกบันทึก implementation รุ่นเก่าให้ชัด
- เพิ่ม Node version และ CI สำหรับ check → dependency audit → build → production browser regression

## ผลตรวจสุดท้าย

- `npm run check`: ผ่าน TypeScript, CSS/consistency และชุดตรวจ scheduler, integrity, storage, metrics, seed/archive, rooms, checklist, XLSX
- `npm run build`: ผ่าน Next.js 15.5.25 สร้าง 24 หน้าและ standalone assets ครบ
- `npm run check:browser`: ผ่าน 15 สถานการณ์ Chromium ไม่มี page errors และไม่มี asset responses ที่ล้มเหลว รวมการดาวน์โหลด XLSX และ viewport 390 px ของหน้ารายวิชา
- `npm audit --json`: total 0 (critical/high/moderate/low/info เป็น 0)
- `git diff --check`: ผ่าน

หลักฐาน browser ล่าสุดอยู่ใน `output/browser/results.json` พร้อม screenshots และไฟล์ export; CI จะเก็บโฟลเดอร์นี้เป็น artifact ชื่อ `browser-evidence`

## ขอบเขตที่ยังเป็นการขยายผลิตภัณฑ์

แอปยังเป็น planner ที่ใช้ข้อมูล mock และบันทึกในเบราว์เซอร์เดียว การรองรับผู้ใช้หลายเครื่องต้องมี backend/API, authentication/authorization และ transaction ฝั่ง server ส่วน stable provider/instructor/team IDs, workflow อนุมัติห้อง, วันสอนจริง/วันหยุด และการโหลด archive ตามเทอม เป็นงานออกแบบขยายระบบที่ยังไม่ได้เพิ่มในชุดแก้บั๊กนี้

Scheduler ยังค้นหาแบบมีขอบเขตลึก 2 ชั้น จึงไม่รับประกัน optimum หรือพิสูจน์ว่าไม่มีคำตอบ ข้อมูลตัวอย่างยังจัดได้ 18 จาก 19 คาบ โดยเหลือวิชา Responsible AI & Data Governance ตามกรณีสาธิตเดิม
