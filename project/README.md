# KMITL Smart Grid & AI Energy Guardian

Dashboard แบบห้อง Control Room: จำลองบอร์ด IoT (กระแส, แรงดัน, มีคนอยู่หรือไม่) → วิเคราะห์ Energy Waste → ไฟแดง/เขียวแบบ real-time

## รัน (ต้องมี Node.js 22.12+)
```
npm install
npm run dev          # http://localhost:5173  (โหมด Local ไม่ต้องมี backend)
```

## รันแบบมี API (mock)
เปิด 3 เทอร์มินัล
```
npm run mock-api                 # API จำลอง http://localhost:8787
npm run simulate -- after        # สคริปต์จำลองบอร์ด IoT (หรือ: class)
VITE_API_URL=http://localhost:8787 npm run dev
```
(Windows PowerShell: `$env:VITE_API_URL="http://localhost:8787"; npm run dev` หรือสร้างไฟล์ `.env` ตาม `.env.example`)

## ใช้ API จริงของพี่
ตั้ง `VITE_API_URL` เป็น URL ของ API ตามสัญญาใน [API_CONTRACT.md](API_CONTRACT.md) แล้ว `npm run build`

## Deploy
`npm run build` → โฟลเดอร์ `dist/` อัปขึ้น Vercel / Netlify / GitHub Pages ได้
- ตั้ง `VITE_API_URL` ตอน build (เว็บ HTTPS เรียก API แบบ HTTP ไม่ได้)
- API ต้องเปิด CORS ให้โดเมนของเว็บ

## ทดสอบ
`npm test` (ตัวตัดสินใจ + API 20 เทส) · `npm run lint` · CI อยู่ที่ `.github/workflows/ci.yml`

## เอกสาร
[ARCHITECTURE.md](ARCHITECTURE.md) · [API_CONTRACT.md](API_CONTRACT.md)

## ข้อจำกัด
เซนเซอร์เป็นการจำลอง ตัวเลขค่าไฟและคาร์บอนอิงข้อสมมติ (4.2 บาท/หน่วย, 0.5 kgCO₂/kWh, ว่าง 14 ชม. × 22 วัน) ใน `src/engine/energy.ts`
