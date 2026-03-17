# Free Tier Deploy Notes

แพ็กนี้ตั้งใจให้ใช้กับ Firebase Spark + Vercel Hobby ได้ง่ายขึ้น

## ใช้อะไรบ้าง
- Firebase Authentication (Email/Password)
- Cloud Firestore
- Vercel Hobby สำหรับ deploy Next.js
- GitHub สำหรับ source control

## สิ่งที่หลีกเลี่ยงไว้แล้ว
- ไม่พึ่ง Cloud Storage ใน flow import Excel/CSV
- ไม่พึ่ง cron หรือ background job สำหรับการทำงานหลัก
- ไม่ต้องมีหลายโปรเจกต์ Firebase เพื่อรองรับหลายสาขา

## คำแนะนำ
- รวมทุกสาขาใน project เดียว แล้วใช้ role + allowedBranches
- seed admin แค่ครั้งเดียว
- ใช้ export bundle เก็บ backup ก่อน import ไฟล์ใหญ่
- ถ้าข้อมูลเริ่มโตมาก ค่อยพิจารณา Blaze
