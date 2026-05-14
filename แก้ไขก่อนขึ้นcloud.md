# สิ่งที่ต้องแก้ไขก่อนขึ้น Cloud

> อัปเดตล่าสุด: แก้ไขครบทุกรายการแล้ว ✅ — พร้อม Deploy

## ภาพรวม Stack & แผน Deploy ฟรี

| ส่วน | เทคโนโลยี | Deploy ที่ |
|------|-----------|------------|
| Frontend | React 18 + Vite + TypeScript + Tailwind | Vercel (ฟรี) |
| Backend | Fastify + Prisma + TypeScript | Render (ฟรี 750 ชม./เดือน) |
| Database | PostgreSQL | Supabase (ฟรี 500MB) |
| Backup files | Supabase Storage | Supabase (ฟรี 1GB) ✅ |

---

## สถานะรวม — แก้ครบทุกรายการ

| ระดับ | พบ | แก้แล้ว | เหลือ |
|-------|----|---------|-------|
| 🔴 Critical | 4 | 4 | **0** |
| 🟠 High | 7 | 7 | **0** |
| 🟡 Medium | 7 | 7 | **0** |
| 🔵 Low | 4 | 4 | **0** |
| ☁️ Cloud-specific | 1 | 1 | **0** |

---

## ✅ Checklist ทั้งหมด — แก้ไขแล้ว

### 🔴 Critical

- [x] **C-1** `seed.ts` — ใช้ random password/PIN แทน hardcode, print ตอน seed ครั้งแรกเท่านั้น
- [x] **C-2** ลบ `pin` ออกจาก API response ทุกตัว (`sanitizeUser`, `toUserDto`)
- [x] **C-3** Password: min 8 ตัว + ตัวพิมพ์ใหญ่ + ตัวเลข | PIN: ตัวเลขเท่านั้น
- [x] **C-4** `env.ts` throw error ถ้าไม่ตั้ง `JWT_SECRET` ใน production

### 🟠 High

- [x] **H-1** Rate limit `/login` และ `/pin` ไว้ที่ 10 ครั้ง / 15 นาที
- [x] **H-2** `GET /api/users` — เฉพาะ admin เท่านั้น
- [x] **H-3** Permission middleware มี `return` ถูกต้องอยู่แล้ว (false positive)
- [x] **H-4** `/api/reports/export` — เฉพาะ admin เท่านั้น
- [x] **H-5** Path traversal protection ใน `restoreBackupSnapshot` ด้วย `realpath()`
- [x] **H-6** ลบ `passwordHash` และ `pin` ออกจาก backup data
- [x] **H-7** Backup routes ทุกตัวต้องเป็น admin + `/download` ส่งไฟล์โดยตรงไม่เขียน disk

### 🟡 Medium

- [x] **M-1** เพิ่ม `@fastify/helmet` (security headers)
- [x] **M-2** Refresh token rotation — ออก token ใหม่และ revoke ของเดิมทุกครั้งที่ refresh
- [x] **M-3** Logout invalidate token จริง — revoke refresh token ใน DB ทันที
- [x] **M-4** Block CORS wildcard ใน production
- [x] **M-5** `.gitignore` ครอบคลุม `node_modules/`, `dist/`, `.env`, `storage/`
- [x] **M-6** `/health` endpoint พร้อมใช้ + ตั้ง UptimeRobot ทุก 14 นาที
- [x] **M-7** คง `localStorage` (POS ต้องค้าง session) + ลดความเสี่ยง XSS ด้วย helmet CSP (M-1)

### 🔵 Low

- [x] **L-1** PIN ขั้นต่ำ 6 หลัก (เพิ่มจาก 4)
- [x] **L-2** Frontend throw error ถ้า API URL ไม่ใช่ HTTPS ใน production
- [x] **L-3** ~~Request ID~~ — Fastify มี built-in request ID อยู่แล้วใน logger
- [x] **L-4** ปิดช่องทางดู PIN ผ่าน API โดย C-2 และ H-2

### ☁️ Cloud-specific

- [x] **Cloud** Backup `/export` + `/restore` ใช้ Supabase Storage อัตโนมัติเมื่อตั้ง env vars

---

## ⚠️ ผลกระทบต่อการใช้งานของ User

> สิ่งเหล่านี้จะเปลี่ยนพฤติกรรมของระบบที่ผู้ใช้จะรับรู้ได้

### 1. 🔑 Session คงอยู่จนกว่าจะกด Logout
**พฤติกรรม:** ปิด browser แล้วเปิดใหม่ หรือรีเฟรชหน้า — ยังคง login อยู่
**Session หมดเมื่อ:** กด Logout เท่านั้น (token ถูก revoke ใน DB ทันที)
**ใครได้รับผล:** ไม่มีผลกระทบ — พฤติกรรมเหมือนเดิม
**หมายเหตุ:** ใช้ localStorage ซึ่งเหมาะสำหรับ POS ที่เปิดค้างไว้ทั้งวัน

---

### 2. 🔐 กฎรหัสผ่านใหม่ (สำหรับการสร้าง/เปลี่ยนรหัสผ่าน)
**เปลี่ยนจาก:** รหัสผ่าน 1 ตัวอักษรขึ้นไป
**เปลี่ยนเป็น:** อย่างน้อย 8 ตัว + มีตัวพิมพ์ใหญ่ + มีตัวเลข
**ใครได้รับผล:** Admin ที่สร้างหรือแก้ไข user ใหม่
**หมายเหตุ:** รหัสผ่านเดิมใน DB ยังใช้งานได้ปกติ กฎใหม่ใช้เฉพาะตอนสร้างหรือเปลี่ยนรหัสผ่าน

---

### 3. 📟 PIN ต้องมี 6 หลักขึ้นไป
**เปลี่ยนจาก:** PIN 4 หลักขึ้นไป
**เปลี่ยนเป็น:** PIN 6–8 หลัก (ตัวเลขเท่านั้น)
**ใครได้รับผล:** ⚠️ **ทุก user ที่มี PIN 4–5 หลักใน DB จะ login ด้วย PIN ไม่ได้**
**วิธีรับมือ:** Admin ต้องเข้าไปอัปเดต PIN ของทุก user ให้เป็น 6 หลักขึ้นไปก่อน Deploy
**คำสั่ง SQL สำหรับดู PIN ที่สั้นเกินไป:**
```sql
SELECT id, username, displayName, LENGTH(pin) as pin_length
FROM "User"
WHERE LENGTH(pin) < 6;
```

---

### 4. 🚪 Logout ทันที — Token ใช้ไม่ได้ทันที
**เปลี่ยนจาก:** กด logout แล้ว token เดิมยังใช้ได้อีก 15 นาที
**เปลี่ยนเป็น:** กด logout แล้ว token ถูก revoke ใน DB ทันที
**ใครได้รับผล:** ทุกคน แต่ไม่รู้สึกความแตกต่างในการใช้งานปกติ
**ประโยชน์:** ถ้าคนกด logout แล้ว token ไม่สามารถถูกนำไปใช้ต่อได้

---

### 5. 💾 Backup บน Cloud ใช้งานได้ (Admin เท่านั้น)
**เปลี่ยนจาก:** Backup/Restore ใช้ไม่ได้บน cloud (ephemeral disk)
**เปลี่ยนเป็น:** บันทึกและกู้คืนได้ผ่าน Supabase Storage
**ใครได้รับผล:** Admin ที่ใช้ฟีเจอร์ backup
**ต้องทำ:** ตั้งค่า `SUPABASE_URL` และ `SUPABASE_SERVICE_KEY` บน Render + สร้าง bucket ชื่อ `backups` ใน Supabase Storage

---

### 6. 🔄 หลัง Restore Backup — ต้องตั้ง Password/PIN ใหม่ทุก User
**เปลี่ยนจาก:** Restore แล้วใช้งานได้ทันที (เพราะ backup เก็บ passwordHash และ PIN)
**เปลี่ยนเป็น:** หลัง restore ทุก user จะมี PIN `000000` และ passwordHash ว่าง — Admin ต้องไปตั้งค่าใหม่
**เหตุผล:** เพื่อความปลอดภัย ไม่เก็บข้อมูลยืนยันตัวตนใน backup file

---

## 🛠️ สิ่งที่ต้องทำก่อน Go-Live (Checklist สุดท้าย)

```
□ รัน prisma migrate เพื่อสร้าง RefreshToken table ใน DB
  คำสั่ง: cd backend && npx prisma migrate deploy

□ สร้าง bucket ชื่อ "backups" ใน Supabase Storage (ตั้งเป็น private)

□ ตั้ง PIN ทุก user ในระบบให้เป็น 6 หลักขึ้นไปก่อน Deploy

□ ตั้ง env vars ทั้งหมดบน Render (ดูตารางด้านล่าง)

□ แจ้ง user ว่าต้อง login ใหม่หลัง deploy เพราะ session เปลี่ยนจาก localStorage → sessionStorage
```

---

## 🔑 Environment Variables บน Render

| Key | ค่า |
|-----|-----|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase → Settings → Database → Connection string |
| `JWT_SECRET` | สุ่ม 64 ตัวอักษร |
| `JWT_REFRESH_SECRET` | สุ่ม 64 ตัวอักษร (ต้องต่างจาก JWT_SECRET) |
| `FRONTEND_ORIGIN` | `https://your-app.vercel.app` |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Service Role Key จาก Supabase → Settings → API |

**สร้าง JWT Secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
รัน 2 ครั้ง ใช้ค่าแรกเป็น `JWT_SECRET` ค่าที่สองเป็น `JWT_REFRESH_SECRET`

---

## ลำดับการสมัครและ Deploy

1. **[Supabase](https://supabase.com)** — สร้าง DB + Storage bucket "backups"
2. **GitHub** — Push โค้ดขึ้น repository
3. **[Vercel](https://vercel.com)** — เชื่อม GitHub → ตั้ง `VITE_API_BASE_URL`
4. **[Render](https://render.com)** — เชื่อม GitHub → ตั้ง env vars ทั้งหมด → Deploy
5. **[UptimeRobot](https://uptimerobot.com)** — Ping `https://your-backend.onrender.com/health` ทุก 14 นาที
