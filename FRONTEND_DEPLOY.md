# Frontend: เชื่อม Backend และ Deploy (Dashboard)

เอกสารนี้ครอบคลุมเฉพาะฝั่ง Dashboard ส่วน Backend ดูที่ `DEPLOY.md` ที่ root ของ repo
(ตั้งชื่อต่างจาก `DEPLOY.md` เพราะ Windows/macOS แยกตัวพิมพ์เล็กใหญ่ไม่ได้ จะชนกัน)

## 1) รันในเครื่องกับ Backend จริง (พอร์ต 8799)
Backend ใช้พอร์ต 8787 เป็นค่าเริ่มต้น ต้องสั่ง `PORT=8799` ให้ตรงกับที่ตกลงกัน

```bash
# Terminal 1 — Backend (Node ≥ 22.5)
cd project
npm ci
PORT=8799 CORS_ORIGINS=http://localhost:5173 npm run server

# Terminal 2 — Dashboard
cd project
echo 'VITE_API_URL=http://localhost:8799' > .env.local   # .env* ถูก gitignore
npm run dev                                                # เปิด http://localhost:5173
```
- ต้องเปิดหน้าเว็บที่ `http://localhost:5173` เท่านั้น ถ้าเปิดเป็น `http://127.0.0.1:5173` origin จะไม่ตรง allow-list และ Dashboard จะขึ้น OFFLINE
- ค่า `VITE_*` ถูกฝังตอน build/start แก้แล้วต้อง restart `npm run dev`

## 2) Deploy Dashboard บน Vercel
1. Import repo (เลือก **Only select repositories**)
2. Root Directory = `project` · Preset = Vite · ปล่อย Build/Output/Install เป็นค่าเริ่มต้น
3. Environment Variables: `VITE_API_URL` = URL **https** สาธารณะของ API แล้วกด Deploy
4. เอา URL ของ Vercel ไปใส่ `CORS_ORIGINS` ของ API แล้ว redeploy API
5. แก้ env ภายหลังต้อง **Redeploy**

`http://localhost:8799` ใช้บน Vercel ไม่ได้ เพราะ `localhost` คือเครื่องของผู้เปิดเว็บ ต้อง deploy API ก่อน (หรือเปิด tunnel https ชั่วคราว)

## 3) พฤติกรรมเมื่อ API มีปัญหา
| กรณี | สิ่งที่ผู้ใช้เห็น |
|---|---|
| ปกติ (200) | `API: ONLINE`, log `Telemetry rx`, ข้อมูลมาจาก Backend |
| Network error / timeout 4 วินาที / HTTP 5xx | `API: OFFLINE · LOCAL FALLBACK`, toast **LOCAL ONLY · Backend ไม่ได้รับข้อมูล**, log `[LOCAL]`, beacon มีคำว่า (LOCAL), ไม่มี log หรือ toast ว่า sync สำเร็จ |
| HTTP 4xx | toast **Backend ปฏิเสธข้อมูล** พร้อมข้อความ `errors` ของ Backend, log `[API 4xx]`, สถานะยัง ONLINE |
| API กลับมา | polling ทุก 2 วินาทีเปลี่ยนเป็น ONLINE และแทนที่ข้อมูลด้วยของ Backend |

## 4) ข้อจำกัด
- Contract ยังไม่มี `/api/events` Log panel จึงเป็น log ฝั่ง client เท่านั้น ไม่ใช่ log จาก Backend
- ห้องที่คำนวณแบบ local fallback จะถูกแทนที่เมื่อ polling ดึงข้อมูลจาก Backend ครั้งถัดไป เพราะ Backend ไม่เคยรับข้อมูลนั้น
- ใช้ polling ไม่ใช่ real-time จึงช้าได้ประมาณ 2 วินาที
- ถ้า Backend อยู่บน Render free tier ฐานข้อมูลหายเมื่อ restart และ cold start ประมาณ 1 นาที ระหว่างนั้น Dashboard ขึ้น OFFLINE (ดู `DEPLOY.md`)
