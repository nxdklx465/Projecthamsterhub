# ผลทดสอบ Frontend ↔ API (contract v1)

สภาพแวดล้อม: Node 22.22, รัน Backend จาก repo นี้ด้วย `PORT=8799 CORS_ORIGINS=http://localhost:5173 npm run server`

## ทดสอบแล้วกับ Backend จริง
| รายการ | ผล |
|---|---|
| GET /api/health | 200 `{"ok":true}` |
| CORS: Origin `http://localhost:5173` | ได้ header `Access-Control-Allow-Origin: http://localhost:5173` |
| CORS: Origin `https://evil.example` | ไม่มี header (ถูกปฏิเสธ) |
| OPTIONS /api/telemetry (preflight) | 204, Allow-Methods `GET,POST,OPTIONS`, Allow-Headers `Content-Type` |
| POST /api/telemetry (20 A, ไม่มีคน) | 200, `Energy Waste`, มี reasons และ monthly |
| POST /api/telemetry (ค่าผิด 3 ช่อง) | 400 พร้อม `errors[]` 3 ข้อความ |
| GET /api/rooms, GET /api/readings | 200 รูปแบบตรง contract (ได้ 7 ห้อง) |
| GET /api/events | 404 (ตรงกับ contract ที่ยังไม่มี) |
| `api.ts` ของ Dashboard ยิง Backend จริง: send | `source: backend` พร้อม reasons |
| `api.ts` ยิงค่าผิด | โยน `ApiRejected` พร้อมข้อความ validation ของ Backend |
| `api.ts` หลังปิด Backend | `checkHealth` เป็น false, send ได้ `source: local` (UI แสดง LOCAL ONLY) |

## ทดสอบอัตโนมัติ (รวม repo)
`npm run typecheck` (app + server), `npm run lint`, `npm test` ผ่าน 63/63 (รวม 6 เทสใหม่ใน `src/lib/api.test.ts` ที่จำลอง network error, HTTP 5xx, 4xx และการกลับมาออนไลน์), `npm run build` ผ่าน

## ยังไม่ได้ทดสอบ
- เปิดหน้าเว็บจริงในเบราว์เซอร์เพื่อดู Header, toast, log ด้วยตา (ทดสอบที่ระดับโค้ดแล้ว)
- HTTP 5xx จาก Backend จริง (ทดสอบด้วย fetch จำลองเท่านั้น)
- การ deploy บน Vercel และ CORS กับโดเมน Vercel
