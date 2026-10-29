# KMITL Smart Grid & AI Energy Guardian — Architecture

เอกสารนี้อธิบายภาพรวมระบบ, workflow การทำงาน และขอบเขตงาน (scope) ของ Backend และ AI/ML
สถานะ: **Draft v1** · ส่วนที่ทำแล้วมีเครื่องหมาย ✅ ส่วนที่วางแผนไว้มี 🔲

---

## 1. ปัญหาและเป้าหมาย

ห้องเรียนมักเปิดไฟ/แอร์ทิ้งไว้เมื่อไม่มีคนอยู่ ระบบนี้ **ตรวจจับ Energy Waste จากค่ากระแสไฟและสัญญาณการมีคนอยู่ แล้วแจ้งเตือนแบบ real-time** พร้อมประเมินค่าไฟที่สูญเสีย

เป้าหมายหลัก
1. ตรวจจับความสิ้นเปลืองได้ถูกต้องและ **อธิบายเหตุผลได้**
2. แสดงผลบน Engineering Dashboard แบบ real-time
3. ทนต่อข้อมูลผิดพลาด (fault tolerant) — ระบบไม่ล่มเมื่อข้อมูลเสีย
4. ตรวจสอบคุณภาพโค้ดได้ (test + CI + SonarCloud)

---

## 1.1 การแบ่งความรับผิดชอบ

| ส่วน | เจ้าของ | หน้าที่ |
|---|---|---|
| Frontend Dashboard (React) | nackjub | แสดง Beacon / Grid / Chart / Log |
| IoT Simulator (สคริปต์ + ปุ่มในเว็บ) | nackjub | จำลองบอร์ด IoT ยิงค่ากระแส/แรงดัน/คนอยู่ ไปที่ API |
| Backend API + Database | พี่ (mentor) | รับ telemetry เก็บข้อมูล ส่งผลกลับ |
| AI วิเคราะห์ Energy Waste | พี่ (mentor) | รับ telemetry แล้วตัดสินว่าห้องไหนเปลือง |
| **API Contract** | ตกลงร่วมกัน | จุดเชื่อมต่อ ทำให้ทั้งสองฝั่งทำงานคู่ขนานได้ |
| CI / SonarCloud / Deploy | ตกลงร่วมกัน | Deploy ให้คนทั่วไปเข้าใช้ได้ |

> ตารางนี้อิงจากบทสนทนาในทีม ควรยืนยันกับพี่อีกครั้ง

---

## 2. System Architecture

```mermaid
flowchart LR
    subgraph Edge["Edge: Sensor Node"]
        SIM["Sensor Simulator<br/>ปุ่ม/Auto Simulation ✅"]
        ESP["ESP32 + current sensor + PIR<br/>optional 🔲"]
    end

    subgraph BE["Backend (พี่): Node.js + Express + node:sqlite ✅"]
        API["REST API<br/>POST /api/telemetry"]
        VAL["Validation layer"]
        ENG["AI วิเคราะห์ (พี่) ✅<br/>rule + z-score + EWMA"]
        L3["L3 baseline ✅<br/>statistical anomaly"]

    end

    DB[("Database ✅<br/>SQLite")]

    subgraph FE["Frontend: React + TypeScript ✅"]
        DASH["Dashboard<br/>Beacon / Grid / Chart / Log"]
    end

    NOTI["Telegram alert<br/>optional 🔲"]

    SIM --> API
    ESP -.-> API
    API --> VAL --> ENG
    ENG --> L3
    ENG --> DB
    L3 --> DB
    DASH -->|GET /api/rooms, /api/readings ทุก 2 วินาที| API


    API --> DB
    ENG -.-> NOTI
```

**สถานะปัจจุบัน:** Frontend + Decision Engine ทำงานในโหมด Local และมี backend จริงตามสัญญาแล้ว — engine เป็น pure function (`src/engine/energy.ts`) ซึ่ง server import มาใช้ร่วมกัน

---

## 3. Workflow การทำงาน (1 รอบการส่งสัญญาณ)

```mermaid
sequenceDiagram
    participant S as Sensor Node
    participant A as API
    participant V as Validation
    participant E as Decision Engine
    participant D as Database
    participant U as Dashboard

    S->>A: POST /api/telemetry (room, current, voltage, motion)
    A->>V: ตรวจรูปแบบและช่วงค่า
    alt ข้อมูลไม่ถูกต้อง
        V-->>S: 400 + เหตุผล
        V->>D: บันทึก event REJECTED
    else ข้อมูลถูกต้อง
        V->>E: reading
        E->>D: ดึงประวัติห้อง 20 ค่าล่าสุด
        E->>E: rule: motion=false และ current >= 7 A
        E->>E: z-score และ L3 baseline
        E->>D: บันทึก reading + status + reasons
        E-->>S: 200 status + reasons
    end
    loop ทุก 2 วินาที
        U->>A: GET /api/rooms และ GET /api/readings
        A-->>U: สถานะห้องและ readings ล่าสุด
        U->>U: อัปเดต Beacon, Log และกราฟ
    end
```

---

## 4. Decision Engine และ AI/ML Scope

> ส่วนนี้เป็นความรับผิดชอบของ backend seat: server ใช้ engine ร่วมกับ frontend และเพิ่ม L3 baseline; เมื่อ API ล่ม frontend ใช้ local engine เป็น fallback

เราแบ่งเป็นระดับ เพื่อไม่ให้อ้างเกินสิ่งที่ทำจริง

| ระดับ | วิธี | สถานะ | หมายเหตุ |
|---|---|---|---|
| L1 | **Rule-based**: ไม่มีคน และกระแส ≥ 7 A | ✅ | อธิบายได้ 100% |
| L2 | **Statistical anomaly**: z-score เทียบประวัติของห้อง (≥ 5 ค่า, z > 2.5) | ✅ | ไม่ต้องฝึกโมเดล |
| L3 | **Baseline ตามช่วงเวลา**: EWMA แยกตามห้องและชั่วโมงของสัปดาห์ | ✅ | ประเมินจาก readings ใน SQLite; ประเมินเฉพาะข้อมูลปกติเพื่อไม่ให้ baseline เรียนรู้ค่าที่สิ้นเปลือง |
| L4 | **ML (optional)**: Isolation Forest หรือโมเดลพยากรณ์โหลด | 🔲 | ทำเมื่อ L1–L3 เสร็จและมีข้อมูลพอ |

**ข้อตกลงเรื่องความซื่อตรงของข้อมูล**
- ข้อมูลที่ใช้ฝึก/ทดสอบเป็น **ข้อมูลจำลอง (synthetic)** จากสถานการณ์ในหน้าเว็บ ไม่ใช่ข้อมูลจริงของ สจล. ต้องระบุในรายงาน
- ถ้าไม่มีเวลาทำ L4 ให้เรียกระบบว่า *rule-based + statistical anomaly detection* ไม่เรียกว่า machine learning

**การวัดผล (Evaluation)**
- สร้างชุดสถานการณ์จำลองที่รู้เฉลยล่วงหน้า (เช่น 500 รายการ: ปกติ / เปิดไฟทิ้ง / ค่ากระโดดผิดปกติ)
- รายงาน Precision, Recall, F1 ของแต่ละระดับ เปรียบเทียบ L1 vs L1+L2 vs L3 (ตารางเดียวใช้เล่าในพอร์ตได้)

**ตัวเลขประหยัดพลังงาน**
- P = V × I → kWh/เดือน = P × ชั่วโมงที่ว่าง → บาท และ kg CO₂
- ค่าสมมติ (ปรับได้ใน `src/engine/energy.ts`): ค่าไฟ 4.2 บาท/หน่วย, 0.5 kgCO₂/kWh, ว่าง 14 ชม./วัน × 22 วัน
- ต้องแทนด้วยตัวเลขจริงของ สจล. ถ้าหาได้

---

## 5. Backend Scope

> พี่เป็นเจ้าของ ฝั่งเราเขียน API Contract + mock API เพื่อพัฒนา Dashboard ไปพร้อมกัน

**อยู่ใน scope**
- REST API + validation + บันทึกลง SQLite ด้วย `node:sqlite` (ต้องใช้ Node.js ≥ 22.5; แสดง `ExperimentalWarning` ตอนรันเทสต์)
- เรียก Decision Engine ฝั่ง server โดยใช้โค้ดเดียวกับ frontend
- v1 ใช้ polling ผ่าน `GET /api/rooms` และ `GET /api/readings` ทุก 2 วินาที; SSE เป็น endpoint เสริมที่ต้องตกลงก่อนเพิ่ม
- Unit tests ของ engine และ integration tests ของ API ต้องรันใน CI

**ไม่อยู่ใน scope (ระยะแรก)**
- ระบบล็อกอิน/สิทธิ์ผู้ใช้
- ฐานข้อมูลบนคลาวด์ / multi-server
- การควบคุมอุปกรณ์จริง (สั่งตัดไฟ)

### API Contract

| Method | Path | หน้าที่ |
|---|---|---|
| POST | `/api/telemetry` | รับค่าจากเซนเซอร์ คืนผลวิเคราะห์ |
| GET | `/api/rooms` | สถานะล่าสุดของทุกห้อง |
| GET | `/api/readings?roomId=&limit=` | ประวัติค่าสำหรับกราฟ |
| GET | `/api/events` | (optional) SSE stream อัปเดตแบบ real-time |
| GET | `/api/health` | ตรวจสถานะเซิร์ฟเวอร์ |

รายละเอียด request/response ทั้งหมดอยู่ใน [API_CONTRACT.md](API_CONTRACT.md) (mock API ทำตามสัญญานี้แล้ว ✅)

### Data Model

```mermaid
erDiagram
    ROOM ||--o{ READING : has
    ROOM ||--o{ EVENT : has
    ROOM {
        string id PK
        string building
        string room_number
        string status
        int updated_at
    }
    READING {
        int id PK
        string room_id FK
        real current
        real voltage
        bool motion
        string status
        int ts
    }
    EVENT {
        int id PK
        string room_id FK
        string level
        string message
        int ts
    }
```

---

## 6. Fault Tolerance

| สถานการณ์ | พฤติกรรมของระบบ |
|---|---|
| ค่ากระแส/แรงดันนอกช่วง (ติดลบ, NaN, > 100 A, > 500 V) | ปฏิเสธ ตอบ 400 บันทึก event ระบบไม่ล่ม |
| หมายเลขห้องว่างหรือมีอักขระต้องห้าม | ปฏิเสธและแจ้งผู้ใช้ |
| ประวัติห้องน้อยกว่า 5 ค่า | ข้าม z-score ใช้ rule อย่างเดียว |
| Component ฝั่ง UI เกิด error | Error Boundary แสดงปุ่ม RECOVER ✅ |
| Storage ฝั่งเบราว์เซอร์เต็ม/ถูกบล็อก | ทำงานต่อในหน่วยความจำ ✅ |
| API ไม่ตอบ | polling แสดง OFFLINE ได้; ตอนส่ง telemetry network/5xx อาจ fallback ไป local และแสดง success/online ต้องแก้ UX และทดสอบโดย nackjub |

---

## 7. คุณภาพโค้ด

- TypeScript (strict) + ESLint ✅
- Unit test ของ Decision Engine 8 ข้อ (Vitest) ✅
- GitHub Actions: typecheck → lint → test → build ✅
- SonarCloud: ไฟล์ตั้งค่าพร้อม (`sonar-project.properties`) รอเชื่อมบัญชี 🔲

---

## 8. Milestones และ Definition of Done (DoD)

ใช้เอกสารนี้เป็นแหล่งอ้างอิงหลักเพียงฉบับเดียวสำหรับ architecture และ DoD สถานะ “ทำ implementation แล้ว” ไม่เท่ากับ “ส่งมอบแล้ว”: ต้องผ่าน DoD และมีผลตรวจสอบก่อนปิด milestone

### สถานะย่อ

| M | งาน | สถานะ |
|---|---|---|
| M0 ✅ | Frontend + Engine + Auto Simulation + CI | ส่งมอบแล้ว |
| M0.5 ✅ | API Contract, mock API และสคริปต์จำลอง IoT | ส่งมอบแล้ว |
| M1 ✅ | Backend Express + validation + SQLite + API | DoD สำหรับเดโม local ผ่านที่ source commit `7c3bff3`; CI ของ SHA นี้ผ่านครบ ยังไม่ได้ deploy |
| M2 | เชื่อม Dashboard กับ API และ fallback ออฟไลน์ (nackjub) | API integration ใช้งานได้; การแจ้ง success หลัง fallback เมื่อ API ล้มเหลวยังต้องส่งต่อให้ nackjub ตรวจ |
| M3 ✅ | L3 baseline และชุดประเมินผล | ผ่าน DoD ใน local verification ของ branch ปัจจุบัน; ทดสอบรายงานซ้ำและ replay ตามเวลาแล้ว |
| M4 (ทางเลือก) | L4, Telegram alert, ESP32 | ยังไม่ทำ |
| M5 | รายงาน/พอร์ตและคลิปสาธิต | ยังไม่ทำ |

### M1 — Backend API

**Definition of Done**

- API จริงทำตาม `project/API_CONTRACT.md`; `project/server/api.test.ts` เรียก contract suite เดียวกันกับทั้ง Express จริงและ mock โดยไม่แก้ `project/API_CONTRACT.md`
- Validation ปฏิเสธข้อมูลผิด บันทึก event พร้อมเหตุผลใน SQLite และ API ยังทำงานต่อได้; `app.test.ts` ตรวจเหตุผลในตาราง `events` และยืนยันว่าไม่มี reading ผิดถูกบันทึก
- SQL ใช้ prepared statements เท่านั้น; `readings` เป็น append-only และไม่มีเส้นทางแก้ไขหรือลบ
- `npm ci`, typecheck, lint, test และ build ผ่านใน GitHub Actions ของ source commit ที่ส่งขึ้น branch; ผล local verification ล่าสุดอยู่ในหัวข้อ 8 ด้านล่าง
- ไม่ commit `.env` หรือ `project/dist/`

### M3 — L3 และการประเมินผล

**Definition of Done**

- L3 ใช้ EWMA แยกตามห้องและชั่วโมงของสัปดาห์ โดยไม่เรียนรู้จาก readings ที่ตรวจว่าเป็นการสิ้นเปลือง
- `npm run evaluate` สร้างผลซ้ำได้จากข้อมูลสังเคราะห์ตามลำดับเวลา โดยไม่ใช้ข้อมูลอนาคต
- รายงาน Precision, Recall, F1, ผลแยกประเภท และจำนวน readings ที่ L3 ประเมินหรือข้าม พร้อมระบุข้อจำกัดและสมมติฐาน

ผลที่มีใน branch ปัจจุบัน (ข้อมูลสังเคราะห์ 4 สัปดาห์, 6 ห้อง, 16,128 readings, seed 42): L1 ได้ Precision/Recall/F1 = 100.0%/53.5%/69.7%; L1+L2 = 90.1%/66.9%/76.8%; L1+L2+L3 = 90.5%/74.5%/81.7%. L3 ประเมิน 10,660 readings, ข้ามเพราะประวัติน้อย 5,444 readings และข้ามเพราะ baseline เรียบเกินไป 24 readings เลือก `BASELINE_K=6` จากการ sweep: Recall คงที่ 74.5% ระหว่าง k=3–6 ขณะที่ Precision เพิ่มจาก 75.2% เป็น 90.5%; ผลยังคงเหมาะสมบน seed 42, 7, 99 และ 2026 ดูรายงานเต็มที่ [EVALUATION.md](EVALUATION.md)

**Cold-start ของ L3:** baseline แยกตามห้องและ hour-of-week; ต้องมี readings ปกติที่สะสมอยู่ก่อนอย่างน้อย 5 รายการใน bucket นั้น L3 จึงจะตัดสิน reading ถัดไปได้ (ค่าเริ่มต้น `BASELINE_MIN_SAMPLES=5`). ระหว่างประวัติน้อยกว่า 5 จะข้ามด้วย `insufficient_history`; ถ้า EWMA standard deviation ต่ำกว่า `BASELINE_SD_FLOOR=0.05 A` จะข้ามด้วย `baseline_too_flat`. เฉพาะ reading ที่ผลสุดท้ายเป็น `Normal` จะเข้าฐาน จึงอาจใช้เวลานานขึ้นในห้อง/ช่วงเวลาที่มีแต่ telemetry ที่ถูกจัดเป็น waste. รายงาน evaluation แสดงจำนวนที่ตัดสินและข้าม แต่ API v1 ไม่ส่งตัวนับเหล่านี้เป็น endpoint แยก

### M2, M4 และ M5

- **M2:** Dashboard polling API จริงและเคยยืนยันการแสดงข้อมูลจาก backend แล้ว; ส่งต่อให้ nackjub ทดสอบ `OFFLINE` เมื่อ network/5xx ล้มเหลว เพราะ `upsertRoom` fallback ไป local analysis ได้ แต่ `handleSend` อาจยังแสดง success/online ทำให้เข้าใจว่า API รับข้อมูลแล้ว
- **M4:** เป็นทางเลือกและต้องตกลง scope ก่อนทำ หากไม่มี L4 ห้ามเรียกระบบว่า machine learning
- **M5:** รายงานและคลิปต้องตรงกับพฤติกรรมที่ตรวจสอบได้ ระบุว่าข้อมูลเป็นข้อมูลสังเคราะห์ และระบุว่าตัวเลขค่าไฟ/คาร์บอน/ชั่วโมง idle เป็นข้อสมมติ

### สถานะการตรวจสอบล่าสุด — 2026-10-29

source commit ที่ตรวจคือ `7c3bff33f4f938a777605bb5810c29c89bceea71` บน branch `fix/duplicate-seeded-rooms`; งานนี้ยืนยัน CI และ local verification สำหรับเดโม local โดยไม่ได้ deploy

- GitHub Actions run [40833235157](https://github.com/mntoyg/Projecthamsterhub/actions/runs/40833235157) เป็น event `push` บน branch และ SHA นี้; job `build` สรุป `success` ทุกขั้น: `npm ci`, typecheck, lint, test และ build
- local `npm run typecheck` และ `npm run lint` ผ่าน; `npm test` ผ่าน 5 files / 73 tests (ครั้งแรก sandbox ปฏิเสธ `realpath` ด้วย `EPERM`; รันซ้ำในสิทธิ์ตรวจสอบแล้วผ่าน); `npm run build -- --outDir <temp>` ผ่าน 1,646 modules โดยไม่เขียนทับ `project/dist/`
- ตรวจทบทวนเอกสาร commit `b737e9d` ซ้ำใน sandbox นี้: typecheck/lint ผ่าน แต่ `npm test` และ build ถูก sandbox ปฏิเสธที่ `realpath` ด้วย `EPERM` ก่อนเริ่มรัน tests/build จึงไม่ใช่ผลทดสอบที่ยืนยันว่าผ่านหรือเป็น assertion/compile failure; หลักฐาน CI ข้างต้นครอบคลุม source SHA `7c3bff3` ส่วน commit `b737e9d` เป็นเอกสารเท่านั้นและยังไม่มี CI ยืนยัน
- `npm ci` ไม่รันซ้ำใน working tree เพราะคำสั่งนี้จะถอด `node_modules`; ใช้ผล install จาก CI ของ SHA เดียวกัน และตรวจแล้วว่าเครื่องมี `tsc`/`vitest` อยู่
- API smoke แบบ in-process + HTTP ใช้ SQLite `:memory:`: ห้องเริ่มต้น 6 ห้องและ ID ไม่ซ้ำ; POST ถูกต้องได้ 200/`Energy Waste`, GET readings คืน power 4.4 kW; POST ผิดได้ 400 พร้อม `errors[]` และ health ยัง 200; CORS อนุญาต `http://localhost:5173` รวม preflight และไม่คืน allow-origin ให้ origin อื่น
- smoke ต่อหลังมีข้อมูลและสร้าง app ใหม่บน DB เดิม: readings ยังอยู่, rooms ยังเป็น 6 ID ที่ถูกต้อง, POST ห้องเดิมไม่สร้าง duplicate
- ตรวจฐานข้อมูลเดิมแบบ read-only: `k-ses.db` มี 7 rooms รวม ID เก่ากับ ID ใหม่ของ `ECC Building/402`; `k-ses-demo.db` มี 12 rooms ที่มีคู่ซ้ำ; `verify-fix.db` มี 6 canonical IDs ไม่ซ้ำ ไฟล์เหล่านี้ไม่ได้ถูกแก้ ใช้ `DB_FILE=:memory:` สำหรับเดโมเพื่อไม่แสดง duplicate และไม่แตะข้อมูลเดิม
- `$env:EVAL_SEED='42'; npm run evaluate` ทำงานใน temp directory ได้ metrics ตรงรายงาน seed 42; SHA-256 ของ `project/EVALUATION.md` ก่อน/หลังเท่ากัน ไม่ได้เขียนทับไฟล์ที่ติดตามใน Git
- npm audit ปัจจุบัน: รวม 14 รายการ (low 1, moderate 4, high 9, critical 0); `--omit=dev` เหลือ high 1 คือ transitive `ws@8.18.3` จาก Supabase Realtime ตาม [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx); audit ระบุว่ามี fix แต่ไม่อัปเกรดก่อนเดโม ให้ทบทวน lockfile และรัน gate หลังเดโมก่อนเปิด public
- ฐานข้อมูล SQLite เป็นไฟล์/หน่วยความจำของ process เดียว เหมาะกับเดโม local; ไม่ยืนยัน HA หรือ concurrent multi-instance และยังไม่มี public deployment
- contract v1 ไม่มี route สำหรับ logs/events; `events` เป็นตารางภายใน backend และ `/api/events` ไม่ใช่ feed สำหรับ UI
- ส่งต่อให้ nackjub: ทดสอบ network fail, HTTP 5xx, HTTP 4xx และ 2xx; network/5xx อาจ fallback ไป local แต่ flow ส่งยัง toast success/online ได้ ควรแสดง `LOCAL/OFFLINE` หรือ error ที่แยกชัดจาก backend success; งานนี้ไม่แก้ UI

## 9. ประเด็นที่ต้องตัดสินใจ (Open Decisions)

1. ยืนยันการแบ่งงานและผู้รับผิดชอบตามหัวข้อ 1.1
2. เลือกผู้ให้บริการ Deploy สำหรับ frontend และ API (API ต้องใช้ HTTPS และเปิด CORS ให้ origin ของเว็บ)
3. จะใช้ฮาร์ดแวร์จริง (ESP32) หรือใช้ตัวจำลองทั้งหมด

## 10. ข้อจำกัด

- เซนเซอร์เป็นการจำลอง ตัวเลขเงินและคาร์บอนอิงข้อสมมติ ไม่ใช่ข้อมูลวัดจริง
- เกณฑ์ 7 A เป็นค่าตั้งต้น ควรปรับตามขนาดห้องและอุปกรณ์จริง
- SQLite ใช้ไฟล์/หน่วยความจำของ process เดียว เหมาะกับเดโม local; เอกสารนี้ไม่ได้ยืนยัน HA, multi-instance หรือ production readiness

## 11. Deploy

### เส้นทางเดโมในเครื่อง: API จริงและตัวจำลอง

เปิดสาม PowerShell terminals ที่โฟลเดอร์ `project/`:

1. Terminal API — ใช้ SQLite ในหน่วยความจำเพื่อไม่เขียนทับฐานข้อมูลเดิม:

   ```powershell
   $env:DB_FILE=':memory:'
   $env:PORT='8799'
   $env:CORS_ORIGINS='http://localhost:5173'
   npm run server
   ```

2. Terminal ตัวจำลอง — รอให้ API แสดงว่า listening ก่อน แล้วส่ง telemetry ฉาก energy waste:

   ```powershell
   $env:API_URL='http://localhost:8799'
   npm run simulate -- after
   ```

3. Terminal เว็บ — ให้ Vite ส่ง request ไปยัง API จริง:

   ```powershell
   $env:VITE_API_URL='http://localhost:8799'
   npm run dev
   ```

ตรวจ API ได้ด้วย `Invoke-RestMethod http://localhost:8799/api/health` และ `Invoke-RestMethod http://localhost:8799/api/rooms`; หยุด API และตัวจำลองด้วย Ctrl+C เมื่อจบ การใช้ `:memory:` หมายถึงข้อมูลจะอยู่ตลอดอายุ process เท่านั้น

- ข้อจำกัดสำหรับ UI demo: จนกว่าจะปรับ flow ของ frontend ตาม handoff ด้านบน การแจ้ง success อาจไม่ยืนยันว่า API รับ telemetry แล้ว หากต้องการหลักฐานการรับข้อมูลให้ดู status/response จาก API หรือ output ของตัวจำลองประกอบ
- ไม่มี backend logs/events endpoint ใน contract ปัจจุบัน; log ที่เห็นใน terminal เป็น stdout ของ process และ event validation อยู่ใน SQLite ภายในเท่านั้น

- Frontend: `npm run build` แล้วอัปโฟลเดอร์ `dist/` ขึ้น Vercel/Netlify/GitHub Pages
- ตั้ง `VITE_API_URL` ตอน build ชี้ไปที่ API จริง (ต้อง HTTPS ถ้าเว็บเป็น HTTPS)
- API ต้องเปิด CORS ให้โดเมนของเว็บ
- ห้าม commit ไฟล์ `.env` (อยู่ใน `.gitignore` แล้ว)
