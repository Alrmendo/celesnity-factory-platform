# Celesnity Factory Platform

Factory Data and Production Line Platform — Celesnity Technical Take-Home
Assessment (Software Track).

## Tech stack

- Backend: NestJS 11 (TypeScript), Node.js 22+
- Frontend: Next.js 16 + React 19 (App Router, TypeScript)
- Database: PostgreSQL 16
- Orchestration: Docker Compose

## Cách chạy

```bash
cp .env.example .env   # chỉnh giá trị nếu cần
docker compose up --build
```

- Backend: http://localhost:3001 (health check: `GET /health`)
- Frontend: http://localhost:3000
- Postgres: localhost:5432

Chạy backend trực tiếp trên host (ngoài Docker) để dev nhanh hơn: xem
`backend/.env.example` (dùng `DB_HOST=localhost` vì Postgres publish port ra
host qua docker compose).

### GitHub Codespaces

Mở repo trong Codespaces — `.devcontainer/devcontainer.json` attach thẳng vào
container `backend` (định nghĩa trong `docker-compose.yml`, không phải config
riêng), port 3001 (Backend API) và 3000 (Frontend) tự forward, mặc định
`private`. `docker-compose.yml` không phụ thuộc devcontainer nên vẫn chạy độc
lập bằng `docker compose up` như trên máy local bình thường.

## Trạng thái hiện tại

Đang ở **Day 2 / 4**. Kiến trúc đầy đủ, data model, và Domain Rules v2.2 được
ghi chi tiết trong [`docs/plan-v4.md`](docs/plan-v4.md) — đó là tài liệu tham
chiếu chính, không lặp lại ở đây.

Schema Postgres (9 bảng, Prisma) đã viết xong ở `backend/prisma/schema.prisma`
nhưng **chưa chạy migration thật** — máy code hôm nay không có Docker sống.
Xem mục [Việc cần làm ở máy có Docker](#việc-cần-làm-ở-máy-có-docker) bên
dưới.

Backend là modular monolith NestJS, hiện có 5 module nghiệp vụ (đang rỗng,
chưa có entity/logic thật):

- `SourcesModule`
- `CollectionRunsModule`
- `CanonicalizationModule`
- `ProductionDomainModule`
- `ManagementEventsModule`

## Nhật ký triển khai

### Day 1 — 2026-09-02

**Đã làm:**
- Scaffold NestJS 11 backend (`backend/`), Next.js 16 + React 19 frontend
  (`frontend/`).
- Tạo 5 module nghiệp vụ rỗng đúng vị trí theo `docs/plan-v4.md`
  (`backend/src/modules/*`).
- Thêm `HealthModule` với `GET /health` → `{ status: "ok", db: true|false }`,
  kiểm tra kết nối Postgres bằng `SELECT 1` qua `pg` Pool (provider dùng
  chung, đặt ở `backend/src/database`, để các module sau tái sử dụng).
- Cấu hình DB qua biến môi trường (`@nestjs/config`), không hardcode. Bật
  CORS cho local dev.
- Trang chủ frontend fetch `GET /health` và hiển thị kết quả (loading /
  success / error) để xác nhận nối được backend.
- `docker-compose.yml`: service `postgres` (Postgres 16, volume persist,
  healthcheck `pg_isready`), `backend` (depends_on postgres healthy),
  `frontend` (depends_on backend). `.env.example` ở root (cho docker compose)
  và `backend/.env.example` (cho chạy backend trực tiếp trên host).
- `.gitignore` chuẩn Node/NestJS/Next.js.
- Copy `docs/plan-v4.md` vào repo làm ground truth.
- `.devcontainer/devcontainer.json`: attach vào service `backend` trong
  `docker-compose.yml` (không tạo compose riêng cho devcontainer), forward
  port 3001 (Backend API) và 3000 (Frontend), visibility mặc định `private`,
  để mở thẳng trong GitHub Codespaces (môi trường dev hiện tại, do Docker
  local đang hỏng) mà không cần cấu hình tay.

**Vấn đề gặp phải:**
- `create-next-app` tự động init một git repo lồng bên trong `frontend/`
  (`frontend/.git`) — đã xoá thư mục `.git` đó ngay (không chạy lệnh git nào
  khác) để tránh xung đột khi repo gốc được git init sau.
- `NEXT_PUBLIC_API_URL` bị Next.js inline vào bundle tại thời điểm `next
  build`, không phải runtime — nên trong `frontend/Dockerfile` phải truyền
  giá trị này qua build arg (`--build-arg`, wired qua `docker-compose.yml`),
  không chỉ qua `environment:` lúc chạy container.

**Quyết định phát sinh (nếu có):**
- Thêm một `DatabaseModule` dùng chung (`backend/src/database`) export một
  `pg.Pool` qua token `PG_POOL`, ngoài 5 module nghiệp vụ đã chốt trong plan
  — đây là hạ tầng dùng chung (không phải module nghiệp vụ), cần thiết để
  `/health` kiểm tra kết nối DB, và để các module sau tái sử dụng cùng một
  connection pool thay vì mỗi module tự khởi tạo. Không dùng ORM/ migration
  hôm nay — đúng phạm vi Step 1.
- Backend chạy ở port 3001 (không phải 3000 mặc định của Nest) để tránh đụng
  port 3000 của frontend khi chạy cả hai cùng lúc trên host.

### Day 2 — 2026-09-02

**Đã làm:**
- Viết `backend/prisma/schema.prisma` — đủ 9 bảng theo data model v4
  (`docs/plan-v4.md`): `sources`, `collection_runs`, `source_records`,
  `canonical_events`, `canonical_event_sources`, `work_orders`, `batches`,
  `management_events`, `lines`. Tên bảng/cột map snake_case đúng plan bằng
  `@@map`/`@map`; model/field Prisma dùng PascalCase/camelCase chuẩn.
- Cài `prisma` + `@prisma/client` vào `backend/` làm devDependency/dependency.
- Verify OFFLINE (không cần kết nối DB): `npx prisma format` và
  `npx prisma validate` — cả hai chạy sạch, không lỗi cú pháp/cấu trúc.
- Thêm `DATABASE_URL` vào `backend/.env.example` (Prisma CLI cần 1 connection
  string duy nhất, khác với các biến `DB_*` rời rạc mà `pg.Pool` ở
  `DatabaseModule` đang dùng).

**Vấn đề gặp phải:**
- Phát hiện `backend/.env.example` (viết từ Day 1) ghi `DB_PORT=5432` cho
  trường hợp chạy backend trực tiếp trên host — sai, vì `docker-compose.yml`
  publish Postgres ra host ở port **5433** (`5433:5432`), không phải 5432.
  Đã sửa `DB_PORT=5432 → 5433` trong lúc thêm `DATABASE_URL` để 2 giá trị
  không lệch nhau; chưa ảnh hưởng runtime nào trước đó vì chưa ai chạy
  backend trực tiếp trên host để nối `DB_PORT` này.
- `npm install --save-dev prisma@latest` cài về **Prisma 8.0.0-rc.12** — bản
  này đổi hẳn sang CLI "Prisma Developer Platform" mới (`prisma project`,
  `prisma orm`, `prisma deploy`...), không còn `prisma format` / `validate` /
  `migrate dev` theo nghĩa cổ điển nữa. Đã pin lại về **Prisma 6.19.3** (bản
  ổn định mới nhất trước v8) để có đúng các lệnh cần dùng — xem "Quyết định
  phát sinh" bên dưới.

**Quyết định phát sinh:**
- Chọn Prisma làm ORM/migration tool (theo yêu cầu), đặt ở `backend/prisma/`.
  Lý do: migration file tự sinh từ schema, type-safe client cho Step 3, và
  `prisma validate`/`format` cho phép kiểm tra cấu trúc schema hoàn toàn
  offline — đúng nhu cầu hôm nay (code trên máy không có Docker/Postgres
  sống, không kết nối DB được).
- **Pin `prisma`/`@prisma/client` ở `6.19.3`**, không dùng `latest` (hiện là
  `8.0.0-rc.12`, release candidate của CLI thế hệ mới, khác API/command hoàn
  toàn với ORM CLI cổ điển mà `npx prisma migrate dev --name init_schema`
  trong checklist bên dưới cần dùng). Khi máy có Docker nâng cấp lên Prisma
  v8 stable, cần review lại toàn bộ command trong checklist trước.
- Tất cả PK của 9 bảng dùng `String @id @default(uuid())` — plan-v4.md chỉ
  ghi "id (PK)", không chỉ định kiểu; chọn UUID (thay vì serial/int) để
  tránh lộ số thứ tự record qua ID và khớp thói quen chuẩn của Prisma.
- `canonical_event_sources` dùng composite PK
  `@@id([canonicalEventId, sourceRecordPk])` thay vì thêm cột `id` riêng —
  composite PK tự động đóng vai trò unique constraint mà đề bài yêu cầu, nên
  không cần cột thừa.
- `source_records.batch_id`, `canonical_events.batch_id`,
  `management_events.batch_id` cố tình **không** phải FK tới `batches` — ghi
  rõ bằng comment ngay trong schema (không chỉ trong README) để không ai vô
  tình "sửa cho đúng" thành FK sau này.

## Việc cần làm ở máy có Docker

Checklist thủ công — làm ở máy laptop có Docker chạy được, sau khi pull code
mới nhất:

- [ ] Pull code mới nhất
- [ ] `docker compose up --build` (nhớ postgres đã remap host port 5433)
- [ ] `cd backend && npx prisma migrate dev --name init_schema`
- [ ] Verify unique constraint trên `canonical_events.canonical_key` (thử
      insert trùng key, phải bị Postgres từ chối)
- [ ] Verify FK đúng hướng (sources <- collection_runs <- source_records;
      batches <- canonical_event_sources qua canonical_events; work_orders
      <- batches)
- [ ] Verify source_records/canonical_events/management_events.batch_id
      KHÔNG có FK constraint tới batches (đúng chủ đích thiết kế)
