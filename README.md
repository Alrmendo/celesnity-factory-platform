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

Đang ở **Day 3 / 4**. Kiến trúc đầy đủ, data model, và Domain Rules v2.2 được
ghi chi tiết trong [`docs/plan-v4.md`](docs/plan-v4.md) — đó là tài liệu tham
chiếu chính, không lặp lại ở đây.

Schema Postgres (9 bảng, Prisma) đã viết xong ở `backend/prisma/schema.prisma`
nhưng **chưa chạy migration thật** — máy code hôm nay không có Docker sống.
Xem mục [Việc cần làm ở máy có Docker](#việc-cần-làm-ở-máy-có-docker) bên
dưới.

Canonicalization pipeline (Rule 1–5b) đã viết xong ở
`backend/src/modules/canonicalization/` dưới dạng pure function, test bằng
Jest trên mock data trong bộ nhớ — **chưa wire Prisma Client thật** vào
service (chưa query DB thật); việc đó cùng `ProductionDomainModule` (Rule
6–7) để dành Step 4 trên máy có Docker.

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

### Day 3 — 2026-09-02

**Đã làm:**
- Viết canonicalization pipeline thuần TypeScript trong
  `backend/src/modules/canonicalization/`, cover Rule 1–5b
  (`docs/plan-v4.md`, Domain Rules v2.2):
  - `types.ts` — type độc lập với Prisma Client (`SourceRecordInput`,
    `CanonicalEventResult`, `SourceLinkResult`, `CanonicalizationResult`).
  - `source-priority.ts` — bảng tier theo Rule 4 (DATABASE/API = tier 1,
    CRAWLER/MQTT = tier 2).
  - `canonicalization.pipeline.ts` — pure function, không side-effect, không
    gọi DB: `groupByOperationalIdentity` (Rule 2), `resolveGroup` (Rule 5 đầy
    đủ: 5.2 same-source last-observed-wins, 5.3 cross-tier, 5.4 same-tier
    CONFLICT, 5.5 same-tier corroboration), `resolveAll`.
  - `quality-indicators.ts` — `deriveQualityIndicators` (Rule 5b, chỉ phần
    sinh dữ liệu, `acknowledged` luôn khởi tạo `false`).
  - `canonicalization.service.ts` — service mỏng gọi
    `resolveAll` + `deriveQualityIndicators`, nhận `SourceRecordInput[]` trực
    tiếp qua tham số, không query Prisma.
- `canonicalization.pipeline.spec.ts` — 9 test case (7 case bắt buộc theo
  spec + 2 case bổ sung: grouping độc lập với `sourceRecordId`, và "không
  sinh indicator khi ACCEPTED"), tất cả pass qua `npm run test`.
- `npx tsc --noEmit` và `npx eslint` trên toàn bộ thư mục
  `canonicalization/` chạy sạch, không lỗi.

**Vấn đề gặp phải:**
- `eslint --fix` (rule `no-unnecessary-type-assertion`) tự xoá một `as
  SourceRelationship` mà TypeScript compiler (`tsc --noEmit`) sau đó báo là
  **cần thiết** (`intraSourceLinks.get(...)` trả về `SourceRelationship |
  undefined`, không gán thẳng được vào field kiểu `SourceRelationship`) —
  eslint và tsc không đồng nhất ở đây. Sửa bằng cách thêm annotation kiểu
  tường minh cho biến trung gian (`const relationship: SourceRelationship =
  ...`) rồi giữ lại `as` — chạy lại cả `tsc --noEmit` lẫn `eslint` đều sạch
  sau đó. Bài học: sau `--fix`, luôn chạy lại `tsc --noEmit`, không chỉ tin
  eslint report "0 problems".

**Quyết định phát sinh:**
- Pipeline hôm nay hoàn toàn là pure function nhận `SourceRecordInput[]` qua
  tham số — **chưa wire Prisma Client thật** vào service (không query DB,
  không transaction insert→recompute→update). Việc đó để Step 4, làm trên
  máy có Docker/Postgres sống.
- Rule 2 nói "same source, same key → last-observed-wins", nhưng không nói
  rõ phải xử lý sao khi 1 group vừa có nhiều lần đọc từ CÙNG 1 nguồn vừa có
  nhiều nguồn khác nhau cùng lúc. Chọn thiết kế 2 pha: (1) gộp theo `sourceId`
  trong group, chọn "representative" mỗi nguồn bằng last-observed-wins (Rule
  5.2) trước; (2) so sánh tier CHỈ giữa các representative (Rule 5.3/5.4/5.5).
  Lý do: nếu không tách pha, 2 lần đọc lại (re-read) từ cùng 1 nguồn với
  quantity khác nhau sẽ bị hiểu lầm thành "cùng tier, 2 giá trị khác nhau" →
  sai thành CONFLICT trong khi đó chỉ là 1 nguồn tự cập nhật giá trị của nó.
  Không có test case bắt buộc nào phủ đúng kịch bản kết hợp này (7 case yêu
  cầu chỉ test từng nhánh riêng lẻ), nhưng thiết kế 2 pha đảm bảo đúng theo
  đúng tinh thần Rule 2 khi mở rộng sau này.
- `SourceLinkResult.sourceRecordId` (tên field cố định theo yêu cầu) được
  gán bằng `SourceRecordInput.id` (identifier nội bộ của raw record), **không
  phải** `SourceRecordInput.sourceRecordId` (business identifier từ nguồn
  ngoài). Lý do: business `sourceRecordId` không đảm bảo unique trong 1 group
  (xem case B005B — 2 record khác `sourceRecordId` nhưng cùng
  `batchId+station`), nên không thể dùng để xác định chính xác record vật lý
  nào nhận relationship nào. Cách map này khớp với schema fix #2 trong
  plan-v4.md (`canonical_event_sources.source_record_pk → source_records.id`,
  không phải business id) — ghi rõ trong comment tại `types.ts`.
- Khi CONFLICT (Rule 5.4), `quantity`/`eventTime` đại diện của canonical
  event chọn theo record có `receivedAt` mới nhất trong nhóm tranh chấp (tie-
  break `id` tăng dần, đồng nhất với tie-break dùng cho Rule 5.2) — plan-v4.md
  không chỉ định cách chọn, chỉ yêu cầu `status` phải là `CONFLICT`; chọn
  cách này để nhất quán 1 quy tắc tie-break duy nhất xuyên suốt pipeline thay
  vì có 2 quy tắc khác nhau cho 2 tình huống.

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
