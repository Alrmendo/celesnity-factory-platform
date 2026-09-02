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

Đã xong Step 1–5 trong kế hoạch (code). Kiến trúc đầy đủ, data model, và
Domain Rules v2.2 được ghi chi tiết trong
[`docs/plan-v4.md`](docs/plan-v4.md) — đó là tài liệu tham chiếu chính,
không lặp lại ở đây.

- Schema Postgres (9 bảng, Prisma, `backend/prisma/schema.prisma`) đã
  migrate và verify constraint/FK thật trên máy có Docker.
- Canonicalization pipeline (Rule 1–5b,
  `backend/src/modules/canonicalization/`) và production-domain logic
  (Rule 6–7, `backend/src/modules/production-domain/`) đã viết xong dưới
  dạng pure function (test bằng Jest trên mock data, `npm run test`), **và**
  đã wire Prisma Client thật (`CanonicalizationService.ingestAndRecompute`/
  `ingestBatch`, `ProductionDomainService.getBatchStatus`) với integration
  test riêng chạy trên Postgres thật (`npm run test:e2e`).
- Integration test/seed script (Step 5) đã viết xong, đã tự verify được
  wiring đúng cấu trúc (typecheck/lint sạch, chạy đúng tới bước gọi DB thật)
  nhưng **chưa từng chạy thành công lần nào** — máy code lúc đó Docker
  Desktop đang tắt. Xem mục
  [Việc cần làm ở máy có Docker](#việc-cần-làm-ở-máy-có-docker) bên dưới,
  còn 1 việc chưa tick.
- **Chưa làm**: collector thật (Application API/Production Database/
  Supplier Crawler — nguồn dữ liệu thật cho `ingestAndRecompute`),
  `ManagementEventsModule` ghi thật (POST block/resume/ack/note), và UI —
  đều là bước tiếp theo sau Step 5.

Backend là modular monolith NestJS, 5 module nghiệp vụ:

- `SourcesModule` — rỗng, chưa có logic (collector thật, bước sau)
- `CollectionRunsModule` — rỗng, chưa có logic (collector thật, bước sau)
- `CanonicalizationModule` — có pipeline Rule 1–5b + wiring Prisma thật
- `ProductionDomainModule` — có logic Rule 6–7 + wiring Prisma thật
- `ManagementEventsModule` — rỗng, chưa ghi được (chỉ đọc management_events
  qua Prisma trực tiếp trong test/seed hôm nay)

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

### Step 4 — 2026-09-02

Đặt tên "Step 4" thay vì "Day 4" — bước này nối tiếp Step 3 trong cùng kế
hoạch, không nhất thiết là ngày lịch riêng biệt (xem ghi chú đầu bài của
task này).

**Đã làm:**
- **Refactor sót từ Step 3**: đổi tên `SourceLinkResult.sourceRecordId` →
  `sourceRecordPk` trong `canonicalization/types.ts`, cập nhật mọi chỗ dùng
  ở `canonicalization.pipeline.ts` và `canonicalization.pipeline.spec.ts`.
  Lý do: tên cũ trùng ký tự với `SourceRecordInput.sourceRecordId` (business
  identifier, Rule 1) nhưng giá trị thực chất luôn là
  `SourceRecordInput.id` (internal PK) — dễ gây nhầm lẫn khi đọc code sau
  này. Tên mới khớp đúng tên cột `canonical_event_sources.source_record_pk`
  trong `prisma/schema.prisma`. Refactor thuần đổi tên, không đổi giá trị —
  9 test case cũ của Step 3 vẫn pass nguyên sau khi đổi.
- Viết production-domain logic thuần TypeScript trong
  `backend/src/modules/production-domain/`, cover Rule 6–7
  (`docs/plan-v4.md`, Domain Rules v2.2):
  - `types.ts` — `ManagementEventInput`, `BatchState`, `BatchStatusResult`;
    tái sử dụng `Station`/`CanonicalEventResult` từ
    `canonicalization/types.ts` thay vì định nghĩa lại.
  - `station-order.ts` — `STATION_ORDER` (6 bước) + `stationIndex`.
  - `batch-state.ts` — pure function: `getCurrentStation` (Rule 6),
    `getMissingStations`, `resolveIsBlocked`, `resolveBatchState` (Rule 7,
    đúng thứ tự ưu tiên COMPLETED → BLOCKED → IN_PROGRESS → PLANNED),
    `getCompletedQuantity` (Rule 3).
  - `freshness.ts` — `calculateFreshness`, dựa trên `eventTime` của event
    ACCEPTED gần nhất (không phải currentStation, không phải `receivedAt`).
  - `production-domain.service.ts` — service mỏng gộp các hàm trên thành 1
    `getBatchStatus(...)`, nhận input trực tiếp qua tham số, không query
    Prisma.
- `batch-state.spec.ts` (8 case: B001, B002, B003, B004, B006, B007,
  B007-resume, B008) + `freshness.spec.ts` (4 case: NO_DATA, OK, STALE,
  CONFLICT-không-tính) — tổng 12 case bắt buộc, tất cả pass qua
  `npm run test` (22/22 test toàn backend).
- `npx tsc --noEmit` và `npx eslint` trên toàn bộ `canonicalization/` và
  `production-domain/` chạy sạch.

**Vấn đề gặp phải:**
- Không có vấn đề kỹ thuật mới đáng ghi lại — `eslint --fix` lần này không
  gây lệch với `tsc` như Step 3 (đã rerun cả hai sau `--fix` để chắc chắn).

**Quyết định phát sinh:**
- `getBatchStatus` nhận thêm tham số `batchId: string` tường minh (đứng đầu
  danh sách tham số), dù mô tả nhiệm vụ liệt kê chữ ký không có `batchId`.
  Lý do: `BatchStatusResult.batchId` là field bắt buộc, nhưng một batch
  PLANNED hợp lệ có `events = []` — không có cách nào suy ra `batchId` từ
  mảng event rỗng. Test bắt buộc chỉ nhắm vào `batch-state.ts`/`freshness.ts`
  (không có `production-domain.service.spec.ts` nào được yêu cầu), nên thay
  đổi chữ ký ở service không ảnh hưởng Definition of Done.
- `resolveBatchState`'s điều kiện IN_PROGRESS chỉ xét event ở RECEIVING đến
  FOLDING (loại DISPATCH ra, đúng theo mô tả nhiệm vụ) — hệ quả phụ: 1 batch
  mà canonical event DUY NHẤT là DISPATCH CONFLICT (không có trạm nào trước
  đó từng ghi nhận) sẽ đọc ra `PLANNED` thay vì `IN_PROGRESS`, dù Rule 6 vẫn
  tính `currentStation = DISPATCH` cho batch đó. Đây là hệ quả trực tiếp của
  literal spec được giao (không tự suy diễn thêm điều kiện), và không xảy
  ra trong fixture 8-batch thật (DISPATCH luôn có trạm trước đó). Ghi chú
  lại trong comment của `resolveBatchState` để không ai bất ngờ khi gặp case
  này sau này.
- `staleThresholdMinutes` mặc định 15 đặt ở tầng service
  (`production-domain.service.ts`), không đặt default ngay trong
  `calculateFreshness` — giữ pure function ở `freshness.ts` luôn nhận tham
  số tường minh (nhất quán với chủ trương "không dùng `new Date()` ngầm"
  của toàn bộ pure-function layer), default value chỉ là convenience ở lớp
  gọi ngoài cùng.

### Step 5 — 2026-09-02

**Đã làm:**
- `backend/src/prisma/prisma.service.ts` + `prisma.module.ts` (`@Global()`)
  — `PrismaService extends PrismaClient`, connect/disconnect theo
  `OnModuleInit`/`OnModuleDestroy`. Import vào `AppModule`, tách biệt hoàn
  toàn với `DatabaseModule` (`pg.Pool`) của Step 1 — 2 đường kết nối độc
  lập, `DatabaseModule` vẫn chỉ phục vụ `/health`.
- `CanonicalizationService.ingestAndRecompute`/`ingestBatch`: insert 1
  `source_records`, query lại TOÀN BỘ record cùng `batch_id+station`, gọi
  `resolveGroup` (nguyên si từ Step 3), upsert `canonical_events` theo
  `canonical_key`, xoá + insert lại `canonical_event_sources` — tất cả
  trong 1 `$transaction`.
- `ProductionDomainService.getBatchStatus` (DB-backed, async): query
  `batches`/`canonical_events`/`management_events` thật, suy ra
  `acknowledged` từ `management_events` (không có cột riêng), gọi các hàm
  thuần từ Step 4 (nguyên si) để tính state/currentStation/freshness.
- `deriveQualityIndicators` (Step 3) đổi signature nhận thẳng
  `CanonicalEventResult[]` thay vì `CanonicalizationResult[]` (không dùng
  `.sources`) — cập nhật `canonicalize()` và 2 chỗ gọi trong
  `canonicalization.pipeline.spec.ts`, 9 test case Step 3 vẫn pass.
- `backend/test/fixtures/batch-scenarios.ts` — fixture builder dùng chung
  cho cả integration test lẫn seed, dựng đủ 10 scenario (B001–B008, B005A,
  B005B, B006) đúng dữ liệu đã dùng ở mock test Step 3/4, giờ insert được
  qua Prisma (tự tạo `sources`/`collection_runs`/`work_orders`/`batches`
  trước vì có FK thật).
- `backend/test/batch-lifecycle.e2e-spec.ts` — 5 nhóm test case theo đúng
  yêu cầu (10 scenario khớp bảng kỳ vọng; idempotent recompute; recompute
  xét đủ lịch sử — record mới đè record cũ, PRIMARY/SUPERSEDED đúng; B006 +
  ACK_EXCEPTION — acknowledged=true nhưng state không đổi; batchId không
  tồn tại → `NotFoundException`). `beforeEach` TRUNCATE 8 bảng liên quan.
- `backend/prisma/seed.ts` + script `npm run seed` — dùng lại fixture
  builder, ingest cả 10 scenario vào DB dev thật, không truncate trước.
- Chạy thử offline (không cần DB, chỉ để xác nhận wiring đúng cấu trúc,
  KHÔNG phải verify integration thật): `npx tsc --noEmit` sạch toàn repo,
  `npm run test` (unit Step 3/4) vẫn 22/22 pass, `npm run seed` và
  `npm run test:e2e` đều chạy đúng tới bước gọi Postgres thật và dừng lại ở
  `Can't reach database server at localhost:5433` — đúng như kỳ vọng vì máy
  này Docker Desktop KHÔNG chạy (xem "Vấn đề gặp phải"), không phải lỗi
  code.

**Vấn đề gặp phải:**
- Task mô tả máy này "CÓ Docker chạy được" nhưng thực tế Docker Desktop
  không chạy (`docker ps` báo lỗi không kết nối được named pipe daemon,
  process `Docker Desktop.exe` không tồn tại). Đã hỏi và được xác nhận: cứ
  viết code trước, verify integration/seed thật để dành khi Docker được
  bật (xem mục checklist bên dưới, còn 1 việc chưa tick).
- `npx prisma generate` cần chạy lại (bản cũ trong `node_modules/.prisma`
  từ lúc `npm install prisma` ban đầu ở Step 2 đã cũ hơn `schema.prisma`
  hiện tại) — chạy lại `npx prisma generate` (offline, không cần DB) trước
  khi viết code dùng `@prisma/client`.
- `npm run test:e2e` (đã có sẵn từ Step 1, chưa ai từng chạy thử) lỗi ngay
  từ đầu, KHÔNG liên quan gì tới code Step 5: `@nestjs/config` là package
  ESM-only (`"type": "module"`), trong khi `test/jest-e2e.json` compile
  test file sang CommonJS qua `ts-jest` — Jest mặc định bỏ qua
  `node_modules` khi transform (`transformIgnorePatterns` mặc định), nên
  `require()` một package ESM-only từ code đã compile CommonJS bị Node từ
  chối thẳng. Lỗi này có sẵn từ khi `test/app.e2e-spec.ts` được Nest CLI
  scaffold ở Step 1 (import `AppModule` → `ConfigModule` từ `@nestjs/config`),
  chỉ là chưa ai chạy `test:e2e` để phát hiện. Sửa bằng cách thêm
  `"transformIgnorePatterns": []` vào `test/jest-e2e.json` (cho phép Jest
  transform cả `node_modules`) — đây là sửa `test/jest-e2e.json`, không phải
  `npm run test` (script unit Step 3/4, được yêu cầu giữ nguyên và vẫn giữ
  nguyên, 22/22 pass).
- `backend/Dockerfile` copy `package*.json` + `npm ci` TRƯỚC khi copy
  `prisma/schema.prisma` — postinstall của `@prisma/client` (chạy lúc
  `npm ci`) sẽ không thấy schema nên bỏ qua, và `npm run build` (`nest
  build`) không tự chạy `prisma generate`, nên image build ra sẽ dùng
  Prisma Client rỗng/cũ → lỗi compile. Thêm dòng `RUN npx prisma generate`
  sau `COPY . .`, trước `RUN npm run build`.
- `backend/.env` chưa tồn tại trên máy này (chỉ có `.env.example`, `.env`
  bị gitignore) — Prisma CLI/integration test/seed script cần
  `DATABASE_URL`. Tạo `backend/.env` từ `.env.example` (dev credential mặc
  định `celesnity/celesnity`, không phải secret thật, đã có sẵn trong
  `.env.example` đã commit).

**Quyết định phát sinh:**
- `NewSourceRecordInput` KHÔNG đơn thuần là "SourceRecordInput trừ `id`"
  như mô tả nhiệm vụ: bớt `sourceType` (không phải cột thật của
  `source_records`, được suy ra qua JOIN với `sources.type` lúc đọc lại —
  đưa nó vào type ghi sẽ tạo khả năng giá trị lệch với `sources.type` thật),
  thêm `collectionRunId` (FK NOT NULL bắt buộc của Step 2 schema, không có
  cách nào khác để cung cấp). Ghi rõ lý do trong comment tại `types.ts`.
- `source_records.payload` (jsonb) chưa có collector thật nên chưa có raw
  payload thật — service tự sinh `{ quantity }` làm payload tối thiểu, đủ
  để đọc lại `quantity` khi recompute. Sẽ được thay bằng payload thật khi
  có collector (step sau).
- Đổi tên method thuần của Step 4 `ProductionDomainService.getBatchStatus`
  (sync, nhận sẵn events/managementEvents) thành `computeBatchStatus`, để
  tên `getBatchStatus` (async, DB-backed) là API chính callers sẽ dùng.
  Đổi tên thuần tuý, KHÔNG đổi logic bên trong; an toàn vì Step 4 không có
  spec nào gọi method theo tên cũ (chỉ test trực tiếp `batch-state.ts`/
  `freshness.ts`).
- "cùng station" khi tra `ACK_EXCEPTION` (mô tả nhiệm vụ) được suy giảm
  thành "cùng batch, timestamp sau `updated_at` của canonical_event đó" vì
  `management_events` không có cột station trong schema thật (Step 2) —
  trong phạm vi các scenario đang có, mỗi batch tối đa 1 conflict sống tại
  1 thời điểm nên 2 cách diễn giải cho kết quả giống hệt nhau.
- `docker-compose.yml`: thêm `DATABASE_URL` vào `environment` của service
  `backend` (trỏ `postgres:5432` — port nội bộ mạng Docker, khác port 5433
  remap ra host) — cần thiết để `PrismaService` kết nối được khi backend
  chạy trong container, task không nhắc tới file này nhưng thiếu nó thì
  container backend sẽ crash ngay khi `PrismaModule` gọi `$connect()`.

## Việc cần làm ở máy có Docker

Checklist thủ công — làm ở máy laptop có Docker chạy được, sau khi pull code
mới nhất:

- [x] Pull code mới nhất
- [x] `docker compose up --build` (nhớ postgres đã remap host port 5433)
- [x] `cd backend && npx prisma migrate dev --name init_schema`
- [x] Verify unique constraint trên `canonical_events.canonical_key` (thử
      insert trùng key, phải bị Postgres từ chối) — đã xác nhận qua `\d`
      psql trước khi Step 4 bắt đầu.
- [x] Verify FK đúng hướng (sources <- collection_runs <- source_records;
      batches <- canonical_event_sources qua canonical_events; work_orders
      <- batches) — đã xác nhận qua `\d` psql.
- [x] Verify source_records/canonical_events/management_events.batch_id
      KHÔNG có FK constraint tới batches (đúng chủ đích thiết kế) — đã xác
      nhận qua `\d` psql.
- [x] Wire Prisma Client thật vào `CanonicalizationService`/
      `ProductionDomainService` + transaction insert→recompute→update
      (Step 5 — code đã viết xong, đã typecheck/lint sạch; XEM MỤC DƯỚI —
      chưa chạy thành công lần nào vì Docker Desktop tắt lúc code).
- [ ] **Việc còn lại — làm ngay khi Docker chạy được**: `docker compose up
      --build`, sau đó `cd backend && npm run test:e2e` — phải thấy cả 5
      test case trong `batch-lifecycle.e2e-spec.ts` VÀ `app.e2e-spec.ts` cũ
      pass (app.e2e-spec.ts trước đây timeout vì cùng lỗi ESM ở trên, giờ
      nên tự pass). Sau đó thử `npm run seed` 1 lần, xác nhận không lỗi.
      Nếu `test:e2e` fail vì lý do khác ngoài "không tới được DB", đó là
      vấn đề thật cần sửa, không phải môi trường.
