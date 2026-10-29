# แผนเดโม K-SES — 30 ต.ค. 2026

ปรับปรุง 29 ต.ค. 2026 · branch โค้ด `fix/duplicate-seeded-rooms` · source SHA `7c3bff33f4f938a777605bb5810c29c89bceea71`

สถานะทุกข้อในเอกสารนี้มาจากคำสั่งที่รันจริงบนเครื่องนี้วันที่ 29 ต.ค. 2026 ข้อที่ยังไม่ได้ยืนยันระบุไว้ตรง ๆ

---

## 1. เป้าหมายของเดโม

### ต้องพิสูจน์ให้ผู้ฟังเห็น

| # | สิ่งที่ต้องพิสูจน์ | พิสูจน์อย่างไรบนหน้าจอ |
|---|---|---|
| 1 | ระบบรับ telemetry จริงผ่าน HTTP แล้ววิเคราะห์ได้ ไม่ใช่หน้าเว็บที่คำนวณเอง | dashboard แสดง `API: ONLINE` และตัวเลขเปลี่ยนตามที่ simulator ยิงเข้า API |
| 2 | ตัดสินใจได้และ **อธิบายเหตุผลได้** | `reasons[]` ที่ API ตอบกลับ เช่น `"กระแส 20.0 A ≥ 7 A และไม่มีคนอยู่"` |
| 3 | ทนข้อมูลเสีย ไม่ล่ม | POST ข้อมูลผิด → `400` พร้อม `errors[]` แล้ว `/api/health` ยังตอบ `200` |
| 4 | ตรวจจับได้มากกว่าเกณฑ์คงที่ | ตาราง Precision/Recall/F1 จาก `project/EVALUATION.md`: L1 → L1+L2 → L1+L2+L3 ได้ F1 69.7% → 76.8% → 81.7% |
| 5 | คุณภาพโค้ดตรวจสอบได้ | gate ผ่านครบ 5 ขั้น และ CI บน GitHub Actions |

### จะไม่พูดถึง

- **ไม่อ้างว่า deploy ขึ้นออนไลน์แล้ว** — ยังไม่มี URL สาธารณะ เดโมรันบนเครื่อง
- **ไม่เรียกระบบว่า machine learning** — ยังไม่มี L4 ให้เรียกว่า *rule-based + statistical anomaly detection*
- **ไม่อ้างว่าข้อมูลเป็นข้อมูลจริงของ สจล.** — เป็นข้อมูลสังเคราะห์ทั้งหมด
- **ไม่อ้างว่าฐานข้อมูลเก็บถาวร** — SQLite เป็นไฟล์ในเครื่อง/คอนเทนเนอร์ เหมาะกับการสาธิต
- ไม่พูดถึง ESP32 ว่าทำแล้ว (ยังเป็น optional ที่ยังไม่ได้ทำ)
- ไม่พูดถึง Telegram alert, SSE (`/api/events` ตอบ `404` ตามสัญญาปัจจุบัน) และ SonarCloud (ไฟล์ตั้งค่าพร้อม ยังไม่ได้เชื่อมบัญชี)

---

## 2. Runbook ก่อนเดโม

รันทั้งหมดจาก `D:\code-project\ProjectHamsterHub\Projecthamsterhub` รวมเวลาประมาณ **12–15 นาที** ถ้าไม่ติดปัญหา

### ข้อ 0 — ตรวจ Node.js (10 วินาที)

```bash
node --version
```

ต้องได้ **≥ 22.5** เพราะ API ใช้ `node:sqlite` (ยืนยันแล้ว: เครื่องนี้ `v22.23.4`)

### ข้อ 1 — ตรวจ process และเลือก port (30 วินาที)

อย่าหยุด process ที่ไม่รู้เจ้าของ ตรวจ port ที่จะใช้ก่อน ถ้ามี listener ให้เลือก port ว่างอื่นแทน ไม่ต้อง force-stop process ของผู้ใช้

```bash
Get-Process esbuild,node -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path
Get-NetTCPConnection -LocalPort 8799 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
```

ผลตรวจรอบนี้ไม่พบ `node`/`esbuild` process หรือ listener ที่ port 8799

### ข้อ 2 — ตรวจ branch และ working tree (30 วินาที)

```bash
git branch --show-current; git status --short; git log --oneline -3
```

`git status --short` ต้องไม่มีบรรทัดใด ๆ

### ข้อ 3 — ตรวจ gate โดยไม่แตะ node_modules เดิม (5–7 นาที)

```bash
npm run typecheck
npm run lint
npm test
$buildOut=Join-Path $env:TEMP ("kses-build-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
npm run build -- --outDir $buildOut
```

CI run `40833235157` บน SHA นี้ผ่านครบ `npm ci`, typecheck, lint, test และ build; ในเครื่องตรวจแล้วมี `tsc`/`vitest` พร้อมใช้งาน จึงไม่ต้องรัน `npm ci` ซ้ำใน checkout วันนี้ เพราะ `npm ci` จะถอด `node_modules` เดิม ที่ถูกต้องสำหรับ local gate คือ typecheck/lint ผ่าน, `Test Files 5 passed (5)` `Tests 73 passed (73)` และ build เขียนไปยัง temp path ใหม่

> หาก dependencies ขาดหรือเสีย อย่า rename/delete `node_modules`; ให้หยุดใช้ checkout นี้สำหรับติดตั้งและสร้างสำเนาตรวจแยกหลังเดโม

### ข้อ 4 — เปิด API ด้วยฐานข้อมูลใหม่ (30 วินาที)

ใช้ฐานข้อมูลในหน่วยความจำเพื่อไม่เขียนทับ DB เดิมและไม่สร้างไฟล์ข้อมูลใหม่ใน repo ห้อง seed จะเริ่มต้น 6 ห้องทุกครั้งที่เปิด API

```bash
cd project; $env:PORT='8799'; $env:CORS_ORIGINS='http://localhost:5173'; $env:DB_FILE=':memory:'; npm run server
```

รอบรรทัด `{"level":"info","event":"listening","port":8799,...}` เปิดทิ้งไว้ในหน้าต่างนี้

### ข้อ 5 — ตรวจ API ก่อนขึ้นเวที (1 นาที)

เปิดหน้าต่างใหม่แล้วรันทีละข้อ ข้อ 3 **ต้องได้ 400** และข้อ 5 **ต้องไม่พิมพ์อะไรเลย**

```bash
curl -s http://localhost:8799/api/health
curl -s -X POST http://localhost:8799/api/telemetry -H "Content-Type: application/json" -d "{\"building\":\"ECC Building\",\"roomNumber\":\"402\",\"current\":20,\"voltage\":220,\"motion\":false}"
curl -s -o nul -w "%{http_code}\n" -X POST http://localhost:8799/api/telemetry -H "Content-Type: application/json" -d "{\"building\":\"ECC\",\"roomNumber\":\"\",\"current\":-1,\"motion\":\"yes\"}"
curl -s -D - -o nul -H "Origin: http://localhost:5173" http://localhost:8799/api/health | findstr /i access-control-allow-origin
curl -s -D - -o nul -H "Origin: https://evil.example" http://localhost:8799/api/health | findstr /i access-control-allow-origin
```

### ข้อ 6 — เปิด dashboard ต่อกับ API (1 นาที)

```bash
cd project; $env:VITE_API_URL='http://localhost:8799'; npm run dev
```

เปิด `http://localhost:5173` ต้องเห็นแถบบนขวาเป็น **`API: ONLINE`** ถ้าเป็น `OFFLINE` แปลว่า API ไม่ตอบ กลับไปข้อ 4

### ข้อ 7 — เปิด simulator (30 วินาที)

```bash
cd project; $env:API_URL='http://localhost:8799'; npm run simulate -- after
```

ต้องเห็นบรรทัด `200 ... -> Energy Waste` ไหลออกมาทุก 2 วินาที เปิดทิ้งไว้

### ข้อ 8 — เตรียมแท็บสำรอง (2 นาที)

1. เปิด `project/EVALUATION.md` ค้างไว้ในแท็บหนึ่ง (ตาราง Precision/Recall/F1)
2. เปิด [GitHub Actions run 40833235157](https://github.com/mntoyg/Projecthamsterhub/actions/runs/40833235157) ค้างไว้ (หลักฐาน CI ของ SHA นี้ผ่าน)
3. ถ่าย screenshot dashboard ตอนทำงานปกติเก็บไว้ 2–3 รูป (ดูหัวข้อ 4)

---

## 3. ลำดับการเดโม 10 นาที

| นาที | ทำอะไร | พูดอะไร |
|---|---|---|
| 0:00–0:45 | หน้า dashboard นิ่ง ๆ ชี้ที่การ์ดบน | "ปัญหาคือห้องเรียนเปิดไฟ/แอร์ทิ้งไว้ ระบบนี้ตรวจจับจากค่ากระแสกับสัญญาณการมีคนอยู่ แล้วแจ้งเตือนแบบ real-time" |
| 0:45–2:00 | ชี้ที่แถบ `API: ONLINE` แล้วสลับไปหน้าต่าง simulator | "ตัวเลขบนหน้าจอไม่ได้คำนวณในเบราว์เซอร์ แต่มาจาก REST API ที่รันแยก — นี่คือ simulator ยิง `POST /api/telemetry` ทุก 2 วินาที แล้ว API ตอบ `Energy Waste` กลับมา" |
| 2:00–3:30 | ในแผง **IoT DEVICE SIMULATOR** ตั้ง `ECC Building / 402`, กระแส **20 A**, กด Motion Sensor ให้เป็น **ไม่มีคน** แล้วกด **ส่งสัญญาณ** | "ไม่มีคนอยู่แต่ใช้ไฟ 20 แอมป์ — ระบบตัดสินว่า Energy Waste และ **บอกเหตุผลได้**: กระแส 20.0 A ≥ 7 A และไม่มีคนอยู่ ไม่ใช่กล่องดำ" |
| 3:30–4:30 | กด Motion Sensor ให้เป็น **มีคน** แล้วส่งซ้ำด้วยกระแสเดิม | "ค่ากระแสเท่าเดิมแต่มีคนอยู่ ระบบตอบ Normal — เกณฑ์คือ *ไม่มีคน* และ *กระแสเกิน 7 A* พร้อมกัน" |
| 4:30–5:30 | สลับไปหน้าต่าง terminal รัน curl ข้อมูลผิด (ข้อ 5.3 ใน runbook) แล้วรัน `/api/health` ซ้ำ | "ส่งข้อมูลพัง — ติดลบ ห้องว่าง motion เป็นสตริง ระบบตอบ `400` พร้อมบอกว่าผิดตรงไหนทุกข้อ แล้วเซิร์ฟเวอร์ยังตอบ `200` อยู่ ไม่ล่ม" |
| 5:30–7:30 | เปิด `project/EVALUATION.md` ชี้ที่ตารางผล | "เราวัดผลบนชุดข้อมูลสังเคราะห์ 16,128 readings 6 ห้อง 4 สัปดาห์ ที่รู้เฉลยล่วงหน้า กฎอย่างเดียวได้ F1 69.7% เติม z-score เป็น 76.8% เติม baseline รายชั่วโมงเป็น 81.7% — ที่เพิ่มคือกลุ่มที่ใช้ไฟเกินปกติของห้องตัวเองแต่ยังต่ำกว่า 7 แอมป์ จับได้ 45.5% จากเดิม 0%" |
| 7:30–8:30 | เปิด GitHub Actions run `40833235157` | "CI ของ source SHA `7c3bff3` ผ่าน `npm ci`, typecheck, lint, test 73 ข้อ และ build" |
| 8:30–10:00 | กลับหน้า dashboard | ปิดด้วยข้อจำกัด (หัวข้อ 5) + ขั้นต่อไป: deploy, ESP32 จริง, L4 |

### ถ้าเหลือ 5 นาที — ตัดอะไรออก

เก็บไว้: **2:00–3:30** (ยิง 20 A ไม่มีคน + เหตุผล), **4:30–5:30** (ข้อมูลพัง ระบบไม่ล่ม), **5:30–6:30** (ตารางผลแบบย่อ ชี้แค่ตัวเลข F1 สามค่า)

ตัดออก: ช่วงเกริ่นนำ (ย่อเหลือ 20 วินาที), ช่วง 3:30–4:30 (ทดสอบกรณีมีคน), ช่วง GitHub Actions, ช่วงปิดท้ายแบบยาว

---

## 4. แผนสำรอง

| ถ้าเกิด | ทำอะไร | เตรียมไว้ล่วงหน้า |
|---|---|---|
| **API ล่ม / ไม่ตอบ** | เพื่อเดโม API จริง ให้หยุดส่งและแก้ API ก่อน; ถ้าตั้งใจใช้ local mode ให้ลบ `VITE_API_URL` แล้ว restart Vite พร้อมบอกผู้ฟังว่ากำลังคำนวณในเบราว์เซอร์ | network/5xx ตอนกดส่งอาจ fallback ไป local และ toast success/online ยังขึ้นได้; อย่านับข้อความนั้นเป็น backend success |
| **API ล่มกลางคัน** | การ polling อาจตั้ง `OFFLINE`; ถ้ากดส่งระหว่างล่ม local fallback อาจทำให้ status กลับเป็น online จึงต้องเช็ก API terminal หรือ health เอง | ส่งต่อ nackjub ให้แก้สถานะ `LOCAL/OFFLINE` และผลส่งข้อมูลก่อน demo UI |
| **เน็ตหลุด** | เดโมทั้งหมดรันบน `localhost` ไม่ต้องใช้เน็ต **ยกเว้น**แท็บ GitHub Actions | บันทึก screenshot หน้า GitHub Actions ที่ผ่านเขียว เก็บเป็นไฟล์ไว้ |
| **ต้องติดตั้ง dependencies ใหม่** | CI ของ source SHA ผ่าน `npm ci` แล้ว; ใน checkout นี้มี dependencies พร้อม อย่ารัน `npm ci` วันนี้เพราะจะถอด `node_modules` | ถ้าจำเป็นจริง ให้ทำในสำเนาตรวจแยกหลังเดโม ห้าม rename/delete ของเดิม |
| **port 8799 ถูกยึด** | ตรวจ listener ก่อน แล้วเลือก port ว่าง เช่น `8801`; ตั้ง `PORT`, `API_URL` และ `VITE_API_URL` ให้ตรงกัน | อย่าหยุด process ที่ไม่รู้เจ้าของ; รอบตรวจนี้ port `8799` ว่าง |
| **เครื่องพรีเซนต์ไม่ใช่เครื่องนี้** | ไม่มีทางรันได้ทัน — ต้องใช้เครื่องนี้ หรือ deploy ล่วงหน้า | ยืนยันเรื่องเครื่องให้ชัดคืนนี้ |

### screenshot / วิดีโอสำรอง — ควรเตรียม

**ควรเตรียม** ใช้เวลา ~10 นาที คืนนี้ ถ่าย 4 รูป:

1. dashboard ตอน `API: ONLINE` ทำงานปกติ
2. ผล `POST /api/telemetry` 20 A ไม่มีคน ที่เห็น `reasons[]` ภาษาไทย
3. ผล `400` พร้อม `errors[]` และ `/api/health` ที่ยังตอบ `200`
4. หน้า GitHub Actions เขียว

เพิ่มเติม: อัดคลิปหน้าจอ 2 นาทีของลำดับ 2:00–5:30 ไว้ด้วย ถ้ามีเวลา (เป็น "มีก็ดี" ไม่ใช่ "ต้องมี")

---

## 5. คำถามที่ผู้ฟังน่าจะถาม + คำตอบที่ตรงความจริง

**ถาม: ใช้ AI หรือ machine learning อะไร**
ตอบ: ยังไม่ใช่ machine learning ตอนนี้เป็น **rule-based + statistical anomaly detection** 3 ระดับ — L1 กฎคงที่ (ไม่มีคน + กระแส ≥ 7 A), L2 z-score เทียบประวัติ 20 ค่าล่าสุดของห้องนั้น, L3 baseline EWMA แยกตามห้องและชั่วโมงของสัปดาห์ การทำโมเดล ML (L4) เป็นขั้นถัดไปที่ยังไม่ได้ทำ

**ถาม: ข้อมูลที่โชว์เป็นข้อมูลจริงของ สจล. ไหม**
ตอบ: **ไม่ใช่ เป็นข้อมูลสังเคราะห์ทั้งหมด** สร้างจาก simulator และสคริปต์ `scripts/evaluate.ts` ยังไม่ได้ติดเซนเซอร์จริงในอาคาร

**ถาม: ประหยัดเงินได้เท่าไร / ลดคาร์บอนได้เท่าไร**
ตอบ: ตัวเลขบนหน้าจอเป็น **การประมาณจากข้อสมมติ** ไม่ใช่ค่าที่วัดได้ ใช้ P = V × I แล้วคูณด้วยค่าไฟ 4.2 บาท/หน่วย, 0.5 kgCO₂/kWh และสมมติว่าห้องว่าง 14 ชม./วัน × 22 วัน/เดือน ถ้าได้ตัวเลขจริงของ สจล. มา จะแทนค่าแล้วตัวเลขจะเปลี่ยน

**ถาม: ทำไมเกณฑ์เป็น 7 แอมป์**
ตอบ: เป็นค่าตั้งต้นที่ตั้งเป็น configuration ไม่ได้ฝังในโค้ด ต้องปรับตามขนาดห้องและอุปกรณ์จริง จุดนี้คือเหตุผลที่เราเติม L2 และ L3 เข้าไป เพราะเกณฑ์คงที่ตัวเดียวจับ `subtle_waste` ไม่ได้เลย (Recall 0%)

**ถาม: แม่นแค่ไหน**
ตอบ: บนชุดข้อมูลสังเคราะห์ 16,128 readings เต็มระบบได้ Precision 90.5% / Recall 74.5% / F1 81.7% — และย้ำว่านี่คือผลบนชุดข้อมูลที่เราสร้างเอง ไม่ใช่ผลภาคสนาม

**ถาม: เข้าใช้ได้จากที่ไหน เปิดเว็บได้เลยไหม**
ตอบ: **ยังไม่ได้ deploy ขึ้นออนไลน์** ตอนนี้รันบนเครื่อง มี Dockerfile และคู่มือ deploy พร้อมแล้ว (`DEPLOY.md`) ขั้นต่อไปคือเลือกผู้ให้บริการและปล่อยขึ้นจริง

**ถาม: ระบบสั่งปิดไฟเองได้ไหม**
ตอบ: ไม่ได้ และตั้งใจไม่ทำในเฟสนี้ — ระบบ **รายงานอย่างเดียว ไม่ควบคุมฮาร์ดแวร์** ไม่มี endpoint ใดที่สั่งงานอุปกรณ์

**ถาม: ข้อมูลเก็บไว้นานแค่ไหน**
ตอบ: เก็บใน SQLite เป็นไฟล์เดียว เหมาะกับการสาธิต ยังไม่ใช่ฐานข้อมูลที่ออกแบบมาเก็บระยะยาว ถ้า deploy บน free tier ที่ไม่มี disk ถาวร ข้อมูลจะหายทุกครั้งที่ restart

**ถาม: ใช้ ESP32 จริงหรือยัง**
ตอบ: ยังไม่ใช้ ตอนนี้จำลองทั้งหมด ESP32 อยู่ใน M4 ซึ่งเป็น optional และยังไม่ตัดสินใจ

**ถาม: ความปลอดภัยเป็นอย่างไร**
ตอบ: เฟสนี้ API ไม่มีระบบล็อกอินโดยตั้งใจ การควบคุมอยู่ที่ validation — ปฏิเสธข้อมูลผิดทุกกรณี, ใช้ prepared statement เท่านั้น, ตาราง readings เป็น append-only ไม่มีเส้นทางลบ, จำกัด body ที่ 10 KB และ CORS เป็น allow-list ที่ตรวจแล้วว่าปฏิเสธ origin แปลกปลอมจริง

---

## 6. งานที่ต้องทำให้เสร็จก่อนเดโม

### ต้องมี

| ลำดับ | งาน | เวลาที่ประเมิน | ทำทันคืนนี้ไหม |
|---|---|---|---|
| 1 | ~~**แก้บั๊กห้องซ้ำ**~~ — **เสร็จแล้ว** ที่ `fe354be` บน branch `fix/duplicate-seeded-rooms` `seed()` ใช้ `roomId(room.building, room.roomNumber)` แล้ว ยืนยันบนหน้าจอ: `ROOMS MONITORED 6`, `5 of 6 rooms`, zone ถูกต้องทุกห้อง | — | **เสร็จ** |
| 1.5 | ~~push branch ขึ้น fork เพื่อให้ CI รัน~~ — เสร็จแล้ว: source SHA `7c3bff3` อยู่บน fork และ GitHub Actions run `40833235157` ผ่าน | — | **เสร็จ** |
| 2 | ซ้อมเดโมเต็มรอบตาม runbook ข้อ 0–8 จับเวลา | 20 นาที | **ทัน** |
| 3 | ถ่าย screenshot สำรอง 4 รูป ตามหัวข้อ 4 | 10 นาที | **ทัน** |
| 4 | ส่งให้ nackjub ทดสอบ fallback และ OFFLINE เมื่อ API ใช้งานไม่ได้ | 5 นาที | **ต้องยืนยันก่อนเดโม UI** |
| 5 | ยืนยันว่าเดโมใช้เครื่องนี้ ไม่ใช่เครื่องอื่น | 1 นาที (ถาม) | **ทัน** |

### มีก็ดี

| งาน | เวลาที่ประเมิน | ทำทันคืนนี้ไหม |
|---|---|---|
| Deploy API ขึ้น Render + build dashboard ชี้ไปที่ URL จริง | 1.5–3 ชั่วโมง รวมแก้ปัญหา และต้องสมัครบัญชี | **ไม่แนะนำให้ทำคืนก่อนเดโม** — เสี่ยงเจอ cold start 1 นาทีกลางเวที และข้อมูลหายทุก restart บน free tier ถ้าจะทำ ให้ทำหลังเดโม |
| ~~แก้ประเด็นชื่อ acceptance test~~ — **เสร็จแล้ว** ที่ `c1c7a89` `api.test.ts` รัน contract suite ชุดเดียวกัน (`api-contract-suite.ts`) กับทั้ง real Express + SQLite API และ mock จึงเป็น acceptance test ของบริการจริงตามถ้อยคำใน `AGENTS.md` แล้ว | — | **เสร็จ** |
| อัดคลิปหน้าจอ 2 นาที | 20 นาที | ทัน ถ้าทำข้อ "ต้องมี" เสร็จก่อน |
| เชื่อม SonarCloud | 30–60 นาที | ทำหลังเดโม |
| ปิด Open Decisions: ผู้ให้บริการ deploy, ESP32 จริงหรือจำลอง | — | **ตัดสินใจคืนนี้ได้ 1 ข้อ**: สำหรับเดโมพรุ่งนี้ ใช้ตัวจำลองทั้งหมด ส่วนผู้ให้บริการ deploy ตัดสินใจหลังเดโม |

### ทำไม่ทันคืนนี้ — พูดตรง ๆ

- **L4 / machine learning** ไม่ทันและไม่ควรเริ่ม ถ้าเริ่มคืนนี้จะได้ของที่อธิบายไม่ได้บนเวที ให้ใช้คำว่า *rule-based + statistical anomaly detection* ตามเดิม
- **ESP32 ตัวจริง** ไม่ทัน ไม่ต้องพูดถึงว่าทำแล้ว
- **Deploy แบบ production จริงที่มี persistent disk + HTTPS + CORS allow-list ที่ถูกต้อง** ไม่ทันในคืนเดียวแบบที่มั่นใจได้

---

## 7. ความเสี่ยง เรียงตามผลกระทบ

| # | ความเสี่ยง | ผลกระทบถ้าเกิด | วิธีลดความเสี่ยง |
|---|---|---|---|
| 1 | **ฐานข้อมูลเก่ามีห้องซ้ำ** — `k-ses.db`/`k-ses-demo.db` เป็นไฟล์จากรอบก่อนแก้ seed | หน้า Dashboard อาจแสดงห้องซ้ำหรือ zone `Simulated` | ห้ามเปิด DB เหล่านี้สำหรับเดโม; ใช้ `DB_FILE=:memory:` ซึ่งเริ่มห้อง seed 6 ห้องโดยไม่แตะไฟล์เดิม |
| 1.5 | ~~ห้องซ้ำ 12 ห้อง~~ | — | **ปิดแล้ว** ที่ `fe354be` ยืนยันบนหน้าจอ 6 ห้อง zone ถูกต้อง |
| 2 | **`npm ci` ใน checkout อาจถอด `node_modules`** | ต้องติดตั้งใหม่ก่อนเปิด API/UI | CI ของ SHA นี้ผ่านแล้ว; ใช้ dependencies ที่ติดตั้งอยู่และอย่ารัน `npm ci` ใน checkout วันนี้ |
| 3 | **ใช้เครื่องอื่นพรีเซนต์** | ติดตั้งใหม่ไม่ทัน และยังเสี่ยง Node < 22.5 | ยืนยันเรื่องเครื่องคืนนี้ ถ้าต้องใช้เครื่องอื่นจริง ต้องติดตั้งและซ้อมบนเครื่องนั้นคืนนี้ |
| 4 | **API fallback เงียบเมื่อ network/5xx** | UI อาจรายงาน success ทั้งที่ backend ไม่ได้รับ telemetry | ให้ API online ตลอดช่วงเดโม; ส่ง failure cases ให้ nackjub และตรวจผลจาก API terminal/response |
| 5 | **ยังไม่ได้ deploy** และมีคนถามหา URL | ต้องตอบว่ายังไม่มี | ตอบตามหัวข้อ 5 ชี้ว่ามี `Dockerfile` + `DEPLOY.md` พร้อม และผล docker build/run ที่ทดสอบแล้วอยู่ใน `DEPLOY.md` |
| 6 | **port ถูกยึด** | server ใหม่อาจเปิดไม่ได้หรือ UI คุยผิด port | ตรวจ listener ก่อนเริ่ม; ถ้าถูกใช้ให้เลือก port ว่าง ห้าม force-stop process ที่ไม่รู้เจ้าของ |
| 7 | **`CORS_ORIGINS` ว่าง = ยอมรับทุก origin** | ถ้ามีคนถามเรื่องความปลอดภัยแล้วเราโชว์สดโดยไม่ตั้งค่า จะโชว์ว่ารับทุก origin | ตั้ง `CORS_ORIGINS='http://localhost:5173'` ตอนเปิด server (runbook ข้อ 4) แล้วการทดสอบ origin แปลกปลอมจะไม่คืน header ตามที่ควร |
| 8 | **`npm run evaluate` เขียนทับ `project/EVALUATION.md`** ด้วยรายงานฉบับภาษาอังกฤษ | ไฟล์รายงานภาษาไทยที่ติดตามใน Git อาจถูกทับ | **อย่ารันใน working tree**; หากต้องประเมินให้ใช้ temp working directory และอย่า restore ทับไฟล์จนกว่าจะตรวจ diff/สำรองงานแล้ว |
| 9 | **ผู้ฟังถามเจาะเรื่อง ML** | ถ้าตอบคลุมเครือหรือเคลมเกิน จะเสียเครดิต | ท่องคำตอบข้อแรกในหัวข้อ 5 ให้ขึ้นใจ |
| 10 | **`/api/events` ตอบ 404** ถ้ามีคนลองเรียกตามเอกสาร | เอกสารระบุว่าเป็น optional อยู่แล้ว | ไม่พูดถึง SSE ถ้าถูกถามให้ตอบว่า v1 ใช้ polling ทุก 2 วินาที และ SSE เป็นส่วนเสริมที่ต้องตกลงก่อนเพิ่ม |
| 11 | **npm audit มี dependency advisory** | production dependency tree ยังมี `ws` severity high แบบ transitive | ไม่อัปเกรดก่อนเดโม local; ตรวจ advisory และแก้ lockfile พร้อมรัน gate ก่อน public deployment |

---

## ภาคผนวก — หลักฐานที่รันจริงวันที่ 29 ต.ค. 2026

| สิ่งที่ตรวจ | คำสั่ง | ผล |
|---|---|---|
| Node.js | `node --version` | `v22.23.4` (ผ่านเกณฑ์ ≥ 22.5) |
| branch / working tree | `git branch --show-current`, `git status --short`, `git rev-parse HEAD` | `fix/duplicate-seeded-rooms`, source SHA `7c3bff33f4f938a777605bb5810c29c89bceea71`, สะอาดก่อนเอกสารรอบนี้ |
| เทียบกับ origin | `git branch -vv` | source branch ตรงกับ `origin/fix/duplicate-seeded-rooms`; CI run บน SHA เดียวกันผ่าน |
| ติดตั้ง | `npm ci` | GitHub Actions run `40833235157` บน SHA นี้ผ่าน; ไม่รันซ้ำใน working copy เพราะ `npm ci` จะถอด `node_modules` เดิม |
| typecheck | `npm run typecheck` | ผ่าน ไม่มี error |
| lint | `npm run lint` | ผ่าน ไม่มี error |
| test | `npm test` | `Test Files 5 passed (5)` · `Tests 57 passed (57)` — **รันซ้ำหลังแก้บั๊ก 29 ต.ค. 13:59 ได้ `Tests 73 passed (73)`** |
| build | `npm run build` | `✓ built in 10.96s` · `dist/assets/index-kvLB6Yn6.js 308.33 kB` |
| evaluation | `npm run evaluate` (seed 42) | ตัวเลขตรงกับ `EVALUATION.md` ทุกค่า: L1 100.0/53.5/69.7, L1+L2 90.1/66.9/76.8, L1+L2+L3 90.5/74.5/81.7; รอบตรวจล่าสุดเขียนรายงานใน temp และยืนยันว่าไฟล์ tracked ไม่เปลี่ยน |
| API health | `curl /api/health` (port 8799, DB ใหม่) | `200 {"ok":true}` |
| API telemetry | `POST /api/telemetry` 20 A motion=false | `200` · `"status":"Energy Waste"` · `reasons:["กระแส 20.0 A ≥ 7 A และไม่มีคนอยู่"]` · `monthly:{kwh:1355.2,baht:5691.84,co2:677.6}` |
| API ข้อมูลผิด | `POST` body พัง | `400` · `errors[]` 3 ข้อ แล้ว `/api/health` ยัง `200` |
| CORS allow-list | `Origin: http://localhost:5173` / `Origin: https://evil.example` | คืน header ตรงค่า / **ไม่คืน header** ตามที่ควร |
| readings | `GET /api/readings?limit=3` | คืน reading ที่เพิ่งบันทึก พร้อม `power` และ `timestamp` |
| `/api/events` | `GET /api/events` | `404` ตามสัญญาปัจจุบัน |
| simulator | `npm run simulate -- after` | ยิงทุก 2 วินาที ได้ `200 ... -> Energy Waste` ต่อเนื่อง |
| dashboard ต่อ API | `VITE_API_URL=http://localhost:8799 npm run dev` | แสดง `API: ONLINE` และอัปเดตตาม simulator — ก่อนแก้บั๊กแสดง `ROOMS MONITORED 12`; **หลังแก้ที่ `fe354be` แสดง `6` และ `5 of 6 rooms` ถูกต้อง** |

### รอบตรวจซ้ำหลังแก้บั๊ก — 29 ต.ค. 2026 เวลา 13:59–14:05

| สิ่งที่ตรวจ | ผล |
|---|---|
| gate ครบ 5 ขั้นบน `fix/duplicate-seeded-rooms` | `npm ci` ไม่ติด `EPERM` อีก (เพราะปิด vite dev ก่อน) · typecheck/lint ผ่าน · `Tests 73 passed (73)` · `✓ built in 9.21s` |
| API + simulator ด้วย `DB_FILE=server/data/verify-fix.db` ใหม่ | `GET /api/rooms` ได้ **6 ห้อง** ทุกห้อง id เป็น slug (`ecc-building-402` …) และ zone เป็นค่าเดิม Engineering / Information Tech / Electrical / Mechanical ไม่ใช่ `Simulated` |
| dashboard | `API: ONLINE` · `ROOMS MONITORED 6` · `CRITICAL ROOMS ACTIVE 5 of 6 rooms` · กราฟ ENERGY HISTORY มีข้อมูลไหลเข้า |
| acceptance test | `api.test.ts` รัน `registerApiContractSuite` ชุดเดียวกันกับ real Express + SQLite API และ mock |

### ผลตรวจ Backend/AI ล่าสุด — 29 ต.ค. 2026

| คำสั่ง/การตรวจ | ผลจริง |
|---|---|
| GitHub Actions run `40833235157` บน SHA `7c3bff33f4f938a777605bb5810c29c89bceea71` | `success`: `npm ci`, typecheck, lint, test และ build ทุกขั้น |
| `npm run typecheck` | ผ่านใน working tree |
| `npm run lint` | ผ่านใน working tree |
| `npm test` | ผ่าน 5 files / 73 tests; ครั้งแรก sandbox ปฏิเสธ `realpath` ด้วย `EPERM`, รันซ้ำในสิทธิ์ตรวจสอบแล้วผ่าน |
| `npm run build -- --outDir <temp>` | ผ่าน; 1,646 modules; ไม่เขียนทับ `project/dist/` |
| ตรวจทบทวน commit เอกสาร `b737e9d` ใน sandbox นี้ | typecheck/lint ผ่าน; การรัน tests/build ถูก sandbox ปฏิเสธที่ `realpath` ด้วย `EPERM` ก่อนเริ่ม จึงใช้อ้างว่าผ่าน/ไม่ผ่านตัวโค้ดไม่ได้; CI run ด้านบนยืนยัน source SHA `7c3bff3` ไม่ใช่ commit เอกสารนี้ |
| API smoke (Express จริง + SQLite `:memory:`) | health/rooms/readings ผ่าน; POST ถูกต้อง 200, ผิด 400 และ health ยัง 200; CORS allow/preflight ผ่าน, origin ที่ไม่อนุญาตไม่มี ACAO |
| seed DB ว่างและ DB มีข้อมูล | เริ่มว่างได้ 6 canonical IDs; หลัง POST และ restart บน DB เดิมยัง 6 ห้อง ไม่มี duplicate |
| DB ไฟล์เดิม (read-only) | `k-ses.db` มี 7 rooms พร้อมคู่เก่า/ใหม่; `k-ses-demo.db` มี 12 rooms ซ้ำ; `verify-fix.db` มี 6 IDs ถูกต้อง — ไม่แก้ไฟล์เหล่านี้ ใช้ `:memory:` ในเดโม |
| `npm run evaluate` seed 42 ใน temp | metrics ตรงรายงาน, tracked `project/EVALUATION.md` SHA-256 ก่อน/หลังตรงกัน |
| `npm audit` / `npm audit --omit=dev` | รวม 14 (1 low/4 moderate/9 high); production graph เหลือ 1 high transitive `ws@8.18.3` จาก Supabase Realtime; ไม่อัปเกรดก่อนเดโม |

### ขั้นที่ยังไม่ได้ยืนยัน

- **ไม่ได้ deploy public** ตาม scope ของเดโม local วันนี้; ไม่มีการทดสอบบน host สาธารณะ
- **ไม่ได้รัน `docker build` ซ้ำ** เพราะไม่จำเป็นต่อเส้นทางเดโม local
- **ยังไม่ได้ทดสอบ UI OFFLINE/fallback ด้วย browser ในรอบนี้**; code review พบ silent local fallback ที่อาจแสดง success ทั้งที่ backend ไม่รับ ให้ nackjub ทดสอบตาม handoff ก่อนเดโม UI
- ตรวจ process/port แบบ read-only แล้วไม่พบ `node`/`esbuild` หรือ listener ที่ 8799; ไม่มี process ของผู้ใช้ถูกหยุด
- GitHub Actions ของ source SHA ตรวจโดยตรงแล้ว เป็น run `40833235157` ที่สรุป success ทุก step

### สถานะ milestone ตามที่ยืนยันได้จริง

| M | งาน | สถานะจริง | หลักฐาน | สิ่งที่ยังค้าง |
|---|---|---|---|---|
| M1 | Backend Express + validation + SQLite + API | **ผ่านสำหรับ local demo** | CI run `40833235157` บน SHA `7c3bff3` ผ่าน install/typecheck/lint/73 tests/build · local API smoke ผ่าน health/rooms/readings/POST/CORS · seed restart ไม่มี duplicate บน DB ปัจจุบันที่ถูกต้อง | Public deploy ไม่อยู่ใน scope; ห้ามใช้ DB เก่าที่มี duplicate |
| M2 | เชื่อม Dashboard กับ API + fallback (nackjub) | **API integration มีหลักฐาน; failure UX ยังส่งต่อ** | เอกสารรอบก่อนยืนยัน `API: ONLINE` และ simulator; API smoke ปัจจุบันผ่าน | ให้ nackjub ทดสอบ network fail, 5xx, 4xx, 2xx และแก้ false success/online หลัง local fallback |
| M3 | L3 baseline + ชุดประเมินผล | **ผ่าน local verification** | seed 42 ให้ metrics ตรงรายงาน; cold-start ข้ามจนมี 5 normal readings ใน room/hour-of-week และข้ามเมื่อ SD < 0.05 A | ข้อมูลสังเคราะห์เท่านั้น; ระบุจำนวน judged/skipped และข้อจำกัดทุกครั้ง |
| M4 | L4, Telegram alert, ESP32 | **ยังไม่ทำ** | — | เป็น optional ไม่ทำก่อนเดโม |

---

คำสั่งตรวจสอบเอกสารนี้:

```bash
cd D:\code-project\ProjectHamsterHub\Projecthamsterhub
git log --oneline -1 -- DEMO_PLAN.md project/ARCHITECTURE.md
git status --short
```
