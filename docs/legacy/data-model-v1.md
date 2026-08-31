# NextLink elective data model

## เป้าหมาย

ฐานข้อมูลนี้ออกแบบสำหรับข้อมูลรายวิชาเลือกที่ต้องติดตามทั้งสถานะการเปิดสอน ผู้สอน ผู้ประสานงาน เอกสาร ตารางเรียน และประวัติการเปลี่ยนแปลง โดยให้ dashboard อ่านข้อมูลจาก PostgreSQL ได้โดยไม่ต้องพึ่งข้อความที่รวมหลายความหมายไว้ในช่องเดียว

หมายเหตุการตั้งชื่อ: เอกสารใช้ชื่อเชิงโดเมนแบบ `snake_case` เพื่อให้อ่านเป็นชื่อ table ได้ง่าย ส่วน Prisma Client จะเรียก model แบบ PascalCase เช่น `course_offerings` จะถูกใช้งานผ่าน `prisma.courseOffering` ในโค้ด โดย migration ชุด demo ใช้ชื่อ physical table ตามค่าเริ่มต้นของ Prisma (`CourseOffering` เป็นต้น)

## ความสัมพันธ์หลัก

```text
categories 1 ──── * course_offerings * ──── 1 organizations
                         │
                         ├── * course_offering_contacts * ──── 1 contacts
                         ├── * course_sessions
                         ├── * course_enrollments
                         ├── * course_documents
                         ├── * course_status_history
                         ├── * course_workflow_tasks
                         ├── * course_feedback
                         └── * schedule_exceptions
```

## ตารางหลัก

### `course_offerings`

เก็บรายวิชาที่เปิดในปี/ภาคการศึกษาหนึ่ง ๆ ไม่ใช่แค่ master course เพราะบริษัท ผู้สอน ห้อง และสถานะอาจเปลี่ยนในแต่ละปี

- `academic_year`, `term`, `course_code`, `section`: unique ต่อ offering
- `category_id`, `organization_id`: foreign key ไปยังหมวดหมู่และบริษัท
- `delivery_mode`: `ON_SITE`, `HYBRID`, `ONLINE`
- `weeks`, `capacity`: ข้อมูลแผนการสอนและจำนวนที่รับ
- `course_status`, `documents_status`, `invitation_status`, `mcv_status`: สถานะปัจจุบันสำหรับหน้า dashboard
- `timezone`: ค่าเริ่มต้น `Asia/Bangkok`

สถานะปัจจุบันช่วยให้ dashboard query เร็ว ส่วนประวัติจริงเก็บเพิ่มใน `course_status_history`

### `course_sessions`

แยกหนึ่งช่วงเวลาสอนเป็นหนึ่งแถว:

- `day_of_week`: integer 1–7 โดย 1 = Monday
- `start_time`, `end_time`: PostgreSQL `TIME`, ไม่ควรเก็บเป็น text
- `timezone`: รองรับการแสดงผลที่ถูกต้องเมื่อมีผู้ใช้ต่างเขตเวลา
- `location`, `online_url`: รองรับ on-site, hybrid และ online
- `valid_from`, `valid_until`: ใช้เมื่อเปลี่ยนห้องหรือเวลาเฉพาะช่วง

ตัวอย่างรายวิชาที่สอนอังคารและพุธจะมี 2 แถว ไม่ใช่ข้อความเดียวที่ต้อง parse ทุกครั้ง

### `course_offering_contacts`

เป็น join table เพราะหนึ่งรายวิชาอาจมีผู้สอนหลายคนและผู้ประสานงานหลายคน โดย `role` แยก `INSTRUCTOR` กับ `COORDINATOR` และ `is_primary` ระบุคนหลัก

### `course_enrollments`

เก็บ enrollment เป็นรายนิสิตด้วย `student_ref` ที่ไม่เปิดเผยตัวตน แทนการเก็บจำนวนลงทะเบียนเป็นตัวเลขก้อนเดียว ทำให้คำนวณจำนวน active enrollment และประวัติ drop ได้

ใน demo seed จะสร้าง student ref จำลองตามจำนวนในไฟล์ตัวอย่าง เช่น `mock-21105801-001`

### `course_documents`

เก็บเอกสารเป็น versioned record โดยแยก `type`, `version`, `status`, `filename` และ `storage_key` ออกจาก offering ทำให้รองรับการแก้ template และตรวจสอบย้อนหลังได้

### `course_status_history`

เก็บทุกการเปลี่ยนสถานะเป็น event append-only เช่น ผู้ใดเปลี่ยนจาก `WAITING_SIGNATURE` เป็น `SIGNED` เมื่อไร พร้อม note ประกอบ การแก้สถานะปัจจุบันจึงตรวจสอบย้อนหลังได้

### `course_workflow_tasks`

เก็บสถานะย่อยจากคอลัมน์ใน Google Sheet แบบหนึ่งงานต่อหนึ่งแถว แทนการเพิ่มคอลัมน์ใน `course_offerings` ทุกครั้งที่ชีตมีขั้นตอนใหม่ โดยใช้ `task_key` ที่เสถียร, `label` ที่แสดงให้ผู้ใช้เข้าใจง่าย และ `status` ที่ normalize แล้ว:

- `RECEIVED`: ได้รับแล้ว
- `NOT_RECEIVED`: ยังไม่ได้รับ
- `IN_PROGRESS`: กำลังดำเนินการ
- `DONE`: เสร็จแล้ว (เช่น `Finished` หรือ `OK`)
- `BLOCKED`: ติดปัญหา โดยเก็บข้อความปัญหาจริงไว้ใน `raw_status` และรายละเอียดไว้ใน `detail`
- `NOT_APPLICABLE`, `UNKNOWN`: ยังไม่ถึงขั้นตอนหรือยังระบุไม่ได้

ชุด demo ครอบคลุมงานตามชีตตัวอย่าง เช่น ทำจดหมายเชิญ, แจ้งจำนวนชั่วโมงสอน, แจ้งสิทธิ์ผู้สอนพิเศษกับ MCV, เปิด MCV, ดึงอาจารย์พี่เลี้ยง/อาจารย์พิเศษ, รหัส Join MCV และดึงนิสิตเข้า MCV

### แหล่งข้อมูลและค่าเดิมจากชีต

`course_offerings` มี `source_key`, `source_system`, `source_spreadsheet_id`, `source_sheet_name`, `source_row_number`, `source_hash` และ `raw_payload` เพื่อให้ตามกลับไปยังแถวต้นฉบับได้ และรองรับคอลัมน์ใหม่ที่ยังไม่มี mapping โดยไม่ทำข้อมูลหาย

`course_documents.external_url` เก็บลิงก์ไฟล์ขอเปิดรายวิชาและ Course Syllabus จากชีต ส่วน `mcv_join_code` เก็บรหัส Join MCV ที่ใช้กับนิสิต

### `course_feedback`

เก็บ feedback เป็นรายรายการ มี rating, comment, source และเวลาส่ง ค่าเฉลี่ยที่แสดงใน dashboard คำนวณจากตารางนี้ ไม่ควรกรอกค่าเฉลี่ยทับโดยไม่มีหลักฐาน

### `schedule_exceptions`

เก็บการยกเลิก เลื่อนเรียน เปลี่ยนห้อง หรือเปลี่ยนเป็น online เฉพาะครั้ง โดยไม่ทำลายตารางปกติใน `course_sessions`

## Index ที่มีใน Prisma schema

- offering ตาม `category_id`, `organization_id`, `course_status`
- offering ตาม `academic_year, term`
- session ตาม `offering_id, day_of_week, start_time`
- enrollment ตาม `offering_id, status`
- status history ตาม `offering_id, status_kind, changed_at`
- feedback ตาม `offering_id, submitted_at`
- exception ตาม `offering_id, session_date`

## Data quality rules

- เวลาเรียนต้องเป็น `TIME` และมี timezone ระบุเสมอ
- ไม่ใช้ `-`, ช่องว่าง หรือข้อความกำกวมแทนค่าที่ไม่ทราบ ให้ใช้ nullable หรือสถานะ `WAITING_*`
- ห้ามใช้ email/LINE จริงใน seed และ demo
- การลบข้อมูล offering ควรใช้ soft delete ในระบบจริง หากต้องเก็บประวัติทางการศึกษา
- สถานะที่แก้ไขต้องเขียนลง `course_status_history` พร้อม actor และ timestamp
- ข้อมูลจาก LINE/LLM ไม่ควรเขียนทับสถานะทางการศึกษาทันที ควรผ่าน human approval ก่อน
- ค่าที่มาจากชีตต้องเก็บทั้งค่าที่ normalize แล้วและค่าเดิมใน `raw_status`/`raw_payload` เพื่อไม่สูญเสียข้อความอย่าง `แจ้งแล้วแต่คุณอิทธิพันธ์ไม่ดำเนินการ`

โครงสร้างฉบับใช้งานจริงอยู่ใน [`prisma/schema.prisma`](../prisma/schema.prisma) และข้อมูล mock ที่ใช้ seed อยู่ใน [`data/elective-courses.json`](../data/elective-courses.json)

ไฟล์ CSV ที่สร้างตามรูปแบบชีตตัวอย่างอยู่ที่ [`data/elective-courses.csv`](../data/elective-courses.csv) และสร้างใหม่ได้ด้วย `npm run data:export-csv`
