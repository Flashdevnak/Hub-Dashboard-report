# BNAK Dashboard – Final Deploy Version

โปรเจกต์นี้ย้ายข้อมูล KPI เดิมจากไฟล์ HTML ให้ใช้ Firestore เป็นค่ากลาง พร้อมหน้าเดิมที่ดึงข้อมูล runtime, หลังบ้านแบบแก้ราย KPI ได้ตรง ๆ, สิทธิ์ admin/user, audit log, import/export backup และรองรับหลายสาขาในระบบเดียว

## เวอร์ชันนี้เพิ่มอะไร

- หน้า KPI เดิมทั้งหมดอ่านข้อมูลจาก Firestore แบบ branch-aware
- หลังบ้านแก้ KPI ราย field / รายตาราง / ราย headline ได้ ไม่ต้องเปิด JSON เป็นงานหลัก
- เพิ่มระบบหลายสาขา (`branches`) และเลือกสาขาได้ทั้งหน้าแอปและหน้า static เดิม
- clone ข้อมูลจากสาขาต้นแบบไปสาขาใหม่ได้
- มี audit log, import/export, role manager
- เพิ่ม health endpoint `/api/health`
- เพิ่ม `npm run check:env` สำหรับเช็กตัวแปรแวดล้อมก่อน deploy
- เพิ่ม `firebase.json` และ `firestore.indexes.json` ให้ deploy rules/indexes ได้ตรงขึ้น
- ตั้ง Node engine ขั้นต่ำเป็น `20.9.0`

## โครงข้อมูลสำคัญ

- `site/settings`
  - ข้อมูลแบรนด์, theme, nav, branches, defaultBranchCode
- `pages/{branchCode__slug}`
  - เอกสารของแต่ละหน้า KPI แยกตามสาขา
- `users/{uid}`
  - profile และ role ของผู้ใช้
- `audit_logs/{id}`
  - ประวัติการแก้ไข

## 1) Firebase

เปิดใช้:
- Authentication > Email/Password
- Firestore Database

จากนั้นคัดลอกค่า config มาใส่ใน `.env.local`

## 2) Environment Variables

คัดลอก `.env.example` เป็น `.env.local`

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
FIREBASE_PROJECT_ID=

SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
```

## 3) ติดตั้งและรัน

```bash
npm install
npm run check:env
npm run seed
npm run dev
```

## 4) Deploy Firestore Rules / Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## 5) Deploy ขึ้น GitHub + Vercel

```bash
git init
git add .
git commit -m "final deploy version"
```

จากนั้น:
- push ขึ้น GitHub repository
- import repo เข้า Vercel
- ตั้ง Node.js เป็น 20.x ใน Project Settings
- ใส่ Environment Variables ให้ครบเหมือน `.env.local`
- deploy

## 6) เช็กหลัง deploy

- เปิด `/api/health`
- login ด้วย admin ที่ seed ไว้
- เข้า `/admin`
- ตรวจว่าหน้า KPI โหลดข้อมูลได้
- ทดลองเปลี่ยน branch และแก้ข้อมูล 1 หน้า

## 7) แนวทางใช้งานจริง

- ใช้ `/admin` สำหรับแก้ข้อมูล KPI, สาขา, role, backup
- ใช้ตัวเลือก branch ใน sidebar หรือหน้า static เดิมเพื่อสลับสาขา
- ใช้ clone branch เมื่อต้องเปิดสาขาใหม่จากชุด KPI ต้นแบบ
- ใช้ Import / Export เพื่อ backup ก่อนปรับข้อมูลก้อนใหญ่

## หมายเหตุ

แพ็กนี้พร้อมสำหรับการตั้งค่าและ deploy จริง แต่ยังต้องใส่ environment ของโปรเจกต์คุณเอง และสร้าง Firebase project / Vercel project ของคุณก่อน


## เพิ่มในเวอร์ชันนี้

- Import ตารางจาก `.xlsx`, `.xls`, `.csv` เข้า dataset ของหน้าที่เลือกได้ตรงจากหน้า Admin
- สิทธิ์แบบหลายระดับ: `admin`, `branch_admin`, `user`
- จำกัดสาขาที่เข้าถึงได้ด้วย `allowedBranches`
- Audit log ระดับ field โดยบันทึก `changedFields` และ `changeCount` ทุกครั้งที่แก้หน้า, site, หรือสิทธิ์ผู้ใช้

> หมายเหตุ: หลังดึงแพ็กนี้ไปใช้งาน ให้รัน `npm install` เพื่อดึง dependency `xlsx` เพิ่มก่อน build/deploy


## Import Mapping Wizard

หน้า Admin รองรับการอัปโหลดไฟล์ `.xlsx`, `.xls`, `.csv` แล้วเปิด mapping wizard ให้อัตโนมัติ โดยระบบจะพยายามจับคู่ชื่อคอลัมน์จากไฟล์กับ field ของ dataset เดิมให้ก่อน จากนั้นผู้ดูแลสามารถปรับ mapping, เลือก append/replace, เก็บคอลัมน์ที่ยังไม่จับคู่, และดู preview ก่อนกดนำเข้าได้


## Mapping Template Wizard

- ในหน้า Admin > Pages > Import Excel/CSV สามารถบันทึก mapping เป็น template ได้
- template จะผูกกับ `slug + datasetKey + branchCode` เพื่อให้ครั้งถัดไป auto-apply ได้เอง
- ใช้ได้ทั้ง admin และ branch_admin ตามสิทธิ์สาขา


## Free Tier Mode (Spark + Vercel Hobby)

แพ็กนี้ปรับให้ใช้ได้กับสายฟรีมากขึ้นแล้ว:

- ไม่บังคับ `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` เพราะ flow import ใช้การอ่านไฟล์ใน browser โดยตรง และไม่ได้อัปโหลดไฟล์ขึ้น Cloud Storage
- ใช้ Firestore + Auth เป็นหลัก ซึ่งยังเริ่มต้นได้บน Spark plan
- ไม่มี dependency ที่บังคับให้ต้องเปิด Blaze plan ใน flow ปกติของ dashboard/admin นี้
- ฝั่ง Vercel ควรหลีกเลี่ยง cron ถี่ ๆ เพราะ Hobby จำกัดงาน cron ได้วันละครั้ง

ข้อแนะนำสำหรับสายฟรี:

1. เริ่มด้วย 1 Firebase project + 1 Vercel project ก่อน แล้วแยกสาขาด้วย `branches` ภายในระบบนี้แทนการเปิดหลายโปรเจกต์
2. เปิดเฉพาะ Email/Password Auth และ Firestore ก็พอ
3. import ไฟล์จากหน้า admin แล้วกดบันทึกทันที ไม่ต้องเก็บไฟล์ต้นฉบับในระบบ
4. สำรองข้อมูลด้วย Export Bundle เป็นระยะ เพื่อลดความเสี่ยงเวลาปรับข้อมูลก้อนใหญ่

อ้างอิง: Firebase ระบุว่า Spark เป็น no-cost plan และ Firestore/Auth ใช้งานได้ในแผนนี้ ขณะที่ Cloud Storage มีข้อกำหนด Blaze ในบางกรณี และ Vercel Hobby จำกัด cron ให้รันได้วันละครั้งเท่านั้น.
