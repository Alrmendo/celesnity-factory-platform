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
- Integration test/seed script (Step 5) **đã verify THẬT** trên Postgres
  thật — `npm run test:e2e` pass, 14/14 case `batch-lifecycle.e2e-spec.ts`
  + 1/1 `app.e2e-spec.ts` (là 1 phần của lần chạy `npm run verify:step6`
  ghi lại ở entry Step 6 cuối cùng bên dưới; checklist
  [Việc cần làm ở máy có Docker](#việc-cần-làm-ở-máy-có-docker) đã tick đủ).
- Step 6 **HOÀN TẤT, đã verify THẬT trên Postgres thật** (`npm run
  verify:step6` PASS, xem entry "Step 6 — HOÀN TẤT, verify thật trên
  Postgres thật" — entry cuối cùng của chuỗi Step 6 bên dưới, có bằng chứng
  log thật): collector "Application API" thật (`SourcesModule`,
  `CollectionRunsModule`), service fixture `fixture-api/` (mock Application
  API, có fault injection: HTTP 500 once/always, timeout), retry + backoff
  trong `CollectionRunsService`, và secret handling (API key chỉ nằm trong
  env, không bao giờ ghi vào DB/log).
- **Chưa làm**: collector Production Database (Step 7 — register/verify/
  discover/select/collect + secret handling riêng), Supplier Crawler
  (Step 8 — pagination loop protection), `ManagementEventsModule` ghi thật
  (POST block/resume/ack/note), và UI — đều là bước tiếp theo sau Step 6.

Backend là modular monolith NestJS, 5 module nghiệp vụ:

- `SourcesModule` — `POST /sources`, `GET /sources/:id` (Step 6); config
  JSON không bao giờ chứa secret literal, sanitize thêm 1 lớp phòng thủ ở
  response (xem `sanitize-config.ts`)
- `CollectionRunsModule` — `POST /collection-runs`, `GET
  /collection-runs/:id` (Step 6); gọi fixture-api thật, có retry/backoff,
  reuse nguyên `CanonicalizationService.ingestBatch` để insert + recompute
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
- `tsconfig.build.json` thiếu `"prisma"` trong `exclude` — phát hiện khi
  build/chạy thử ở máy có Docker. `prisma/seed.ts` import
  `test/fixtures/batch-scenarios.ts`; `exclude` chỉ chặn file bị match trực
  tiếp bởi include glob ban đầu, KHÔNG chặn được file bị kéo vào compile
  qua import graph từ 1 file chưa bị exclude — nên khi `prisma/` chưa nằm
  trong `exclude`, `seed.ts` là root file hợp lệ, kéo theo cả `test/` vào
  cùng chương trình biên dịch với `src/`. Không có `rootDir` tường minh nên
  tsc tự suy nó thành thư mục cha chung của `src/`, `test/`, `prisma/`
  (tức `backend/`) thay vì chỉ `src/`, khiến `dist/` bị lồng thêm 1 cấp
  (`dist/src/main.js` thay vì `dist/main.js`) — container chạy
  `CMD ["node", "dist/main.js"]` báo `MODULE_NOT_FOUND`. Sửa bằng cách
  thêm `"prisma"` vào `exclude` của `tsconfig.build.json`: không có file
  nào trong `src/` import ngược lại `prisma/seed.ts`, nên loại nó khỏi tập
  root file cũng loại luôn nhánh import sang `test/` khỏi compile.
- `jest` bị cài lên `30.x` (không tương thích `ts-jest@^29.2.5` repo đang
  dùng) trong lúc cài lại dependency ở máy có Docker — ghim lại
  `jest@^29.7.0` trong `package.json` để khớp đúng `ts-jest`. Máy Windows
  không-Docker (nơi phần lớn code Step 1–5 được viết) vẫn còn
  `node_modules/jest@30.5.1` từ lần cài ban đầu, chưa `npm install` lại
  nên chưa tự đồng bộ theo `package.json` mới — không phải vấn đề vì
  `npm run test` vẫn chạy được bình thường ở đó, chỉ cần lưu ý lần
  `npm install` kế tiếp trên máy đó sẽ tự hạ về `29.7.0`.

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

### Step 6 — 2026-09-03

**Trạng thái: HOÀN TẤT — đã verify THẬT trên Postgres thật.** (Lúc viết
entry này, dòng trạng thái ghi "code xong, verify OFFLINE pass — CHƯA
verify Docker/integration/e2e thật, chờ máy có Docker" — đã lỗi thời từ khi
đó; xem entry **"Step 6 — HOÀN TẤT, verify thật trên Postgres thật"** ở
cuối chuỗi entry Step 6 bên dưới để xem toàn bộ quá trình debug thật (3 lần
sửa/log riêng biệt) + bằng chứng log thật cuối cùng.)

**Đã làm:**
- `fixture-api/` (top-level, ngang hàng `backend/`/`frontend/`) — mock
  "Application API" theo đề bài. Plain Node `http`, **zero dependency**
  (không `npm install`, không framework) — cố ý, để: (1) Dockerize không cần
  layer cài dependency, (2) `require`-able thẳng từ backend e2e test để chạy
  in-process, không cần container thật, miễn máy có Postgres.
  - `GET /events`: yêu cầu header `x-api-key` khớp secret (constructor
    option → env `FIXTURE_API_KEY` → default dev). Trả cố định 2 record
    DISPATCH khớp đúng `docs/plan-v4.md` §3 (B006 quantity 480, B008 quantity
    97 — cùng `eventTime` với record Production DB tương ứng trong
    `batch-scenarios.ts`, để B006 là CONFLICT thật theo Rule 5.4). Theo đúng
    phạm vi thiết kế ở Rule 4 (comment trong file): B001–B005B/B007 không có
    data vì Application API trong scope này chỉ cấp DISPATCH.
  - Fault injection: query param `fault` (hoặc env `FIXTURE_FAULT_MODE` làm
    default) — `none` | `500-once` | `500-always` | `timeout`. `500-once`
    dùng header `x-attempt` (client tự tăng mỗi lần retry) để biết đây là
    lần gọi thứ mấy — fixture-api không giữ state phía server, hoàn toàn
    stateless/deterministic.
  - `docker-compose.yml`: thêm service `fixture-api` (port host 4100),
    `backend` thêm `FIXTURE_API_BASE_URL`/`FIXTURE_API_KEY`, `depends_on`
    `fixture-api` healthy.
- `backend/prisma/schema.prisma`: thêm cột `CollectionRun.errorMessage`
  (nullable, `@db.Text`) — `errorCount` (Int, có sẵn từ Step 2) không phải
  "thông tin lỗi" theo nghĩa mục 3 của yêu cầu Step 6, cần thêm cột text.
  Addition thuần, không đổi field nào đã có. `npx prisma format`/`validate`/
  `generate` chạy sạch offline.
- `CollectionRunsService.runCollection(sourceId)`
  (`backend/src/modules/collection-runs/`): đọc `Source.config` (shape
  `FixtureApiSourceConfig` trong `types.ts`: `{ baseUrl, apiKeyEnvVar,
  fault? }` — **không bao giờ có secret literal**, chỉ có tên env var trỏ
  tới secret thật), resolve API key thật qua `ConfigService.get(apiKeyEnvVar)`
  lúc gọi (chưa từng ghi xuống DB). Ghi đúng 1 row `collection_runs`
  (RUNNING → SUCCESS|FAILED). Retry 3 lần, backoff `50ms * 2^n`, timeout
  2s/request (AbortController) qua `fetchFixtureEvents`
  (`fixture-api-client.ts`) — lỗi 401 không retry (`retryable: false`,
  không tự sửa được bằng cách gọi lại), lỗi 5xx/timeout/network thì retry.
  Khi SUCCESS, map fixture event → `NewSourceRecordInput[]`, gọi thẳng
  `CanonicalizationService.ingestBatch()` (Step 5, nguyên si) — **không viết
  lại** logic canonicalization ở đây.
- `SourcesModule`/`CollectionRunsModule`: implement `POST /sources`, `GET
  /sources/:id`, `POST /collection-runs`, `GET /collection-runs/:id` (đều
  rỗng từ Step 1). `sanitize-config.ts` (sources) redact theo tên field
  (`/key|secret|token|password|credential/i`, trừ field kết thúc bằng
  `envVar` — đó là TÊN biến môi trường, không phải secret) — lớp phòng thủ
  thêm, vì bất biến kiến trúc chính đã đảm bảo config không bao giờ chứa
  secret thật (xem trên).
- `CanonicalizationModule` thêm `exports: [CanonicalizationService]` (thiếu
  từ Step 3, không ai cần import xuyên module cho tới giờ) — bắt buộc để
  `CollectionRunsModule` inject được qua Nest DI thật (không chỉ qua
  `moduleRef.get()` trong test).
- `backend/test/collection-runs.e2e-spec.ts` (Step 6, DB thật + fixture-api
  in-process): `test.each` 2 case fault injection (500-once → SUCCESS sau
  retry, 500-always → FAILED + `errorMessage` + app vẫn `GET /health` được
  bình thường); secret regression `test.each` 3 endpoint (`POST /sources`,
  `GET /sources/:id`, `GET /collection-runs/:id`) + 1 test riêng cho
  application log (spy `process.stdout`/`stderr.write` trong lúc chạy 1
  collection run thật, assert secret không xuất hiện); B006 end-to-end qua
  collector thật (Production DB insert trực tiếp như Step 5 vẫn làm vì
  chưa có DB collector thật — Step 7, + Application API qua
  `CollectionRunsService.runCollection()` thật sự gọi HTTP tới fixture-api)
  → assert `canonical_events` status = CONFLICT thật, `qualityIndicators`
  có `DISPATCH_CONFLICT` chưa acknowledged, batch không COMPLETED.
- Phát hiện khi viết test trên: file e2e thứ 2 cùng truncate/dùng chung
  batchId `B006` như `batch-lifecycle.e2e-spec.ts` — nếu Jest chạy 2 file
  song song (mặc định) trên CÙNG Postgres, có race condition thật (1 file
  TRUNCATE giữa lúc file kia đang insert). Sửa bằng cách thêm
  `"maxWorkers": 1` vào `test/jest-e2e.json` (ép các file e2e chạy tuần tự)
  — cần thiết ngay khi có ≥ 2 file e2e chạm DB thật, không phải riêng Step 6.
  Nhân tiện tách `truncateAll` (trước đó định nghĩa riêng trong
  `batch-lifecycle.e2e-spec.ts`) ra `test/fixtures/db-utils.ts` dùng chung
  cho cả 2 file, tránh 2 danh sách bảng lệch nhau theo thời gian.
- Verify OFFLINE (không cần Docker/Postgres — chỉ cần Node, không đụng
  container nào):
  - `npx tsc --noEmit` sạch toàn repo.
  - `npx eslint "{src,apps,libs,test}/**/*.ts"` sạch toàn repo (chạy lại sau
    `--fix`, không chỉ tin lần đầu — bài học từ Step 3).
  - `npm run test`: vẫn 22/22 pass, không case nào mới (mọi test Step 6 đều
    đụng DB thật nên nằm ở `test:e2e`, không phải `test`) — dán nguyên output:
    ```
    PASS src/modules/canonicalization/canonicalization.pipeline.spec.ts
    PASS src/modules/production-domain/freshness.spec.ts
    PASS src/modules/production-domain/batch-state.spec.ts
    PASS src/app.controller.spec.ts

    Test Suites: 4 passed, 4 total
    Tests:       22 passed, 22 total
    ```
  - Smoke test thủ công KHÔNG đụng Postgres (script tạm, đã xoá sau khi
    chạy): khởi `fixture-api` thật in-process (`createServer` từ
    `fixture-api/server.js`), mock `PrismaService`/`CanonicalizationService`,
    gọi thẳng `CollectionRunsService.runCollection()` qua HTTP thật tới
    fixture-api. Xác nhận đúng 4 nhánh: `500-once` → 1 warning log rồi
    SUCCESS (`errorCount=1`, `recordsRead=2`); `500-always` → 3 lần warning
    rồi FAILED (`errorCount=3`, có `errorMessage`); không fault → SUCCESS
    ngay; env var API key thiếu → throw đúng message (chỉ nêu TÊN biến, không
    có giá trị). Đây KHÔNG thay thế `test:e2e` thật (không có Postgres/DI đầy
    đủ qua Nest), chỉ xác nhận logic HTTP+retry+mapping tự viết không có bug
    rõ ràng trước khi chờ máy có Docker.
  - `fixture-api/server.js` tự chạy standalone (`node -e` gọi trực tiếp
    `createServer`) qua `fetch` thật: xác nhận thiếu key/sai key → 401, đúng
    key không fault → 200 + đúng 2 event, `500-once` đúng thứ tự 500 rồi
    200, `500-always` luôn 500, `/health` → 200.

**Vấn đề gặp phải:**
- `Record<string, unknown>` (kiểu `CreateSourceDto.config`) không tự gán
  được vào Prisma `InputJsonValue` (Prisma yêu cầu kiểu JSON đệ quy cụ thể,
  `unknown` không chứng minh được là JSON hợp lệ dù runtime luôn đúng) — ép
  kiểu tường minh `as Prisma.InputJsonValue` ở `sources.service.ts` và
  trong test. Không xảy ra ở `canonicalization.service.ts` (Step 5) vì chỗ
  đó dùng object literal cụ thể (`{ quantity }`), TypeScript suy luận kiểu
  hẹp hơn nên tự khớp được.
- `emitDecoratorMetadata` + `isolatedModules` (đã bật từ Step 1) đòi type
  dùng trong signature có decorator (`@Body() dto: CreateSourceDto`) phải
  import bằng `import type` nếu type đó đến từ file khác — sửa
  `sources.controller.ts` dùng `import type { CreateSourceDto }`.
  `RunCollectionDto` ở `collection-runs.controller.ts` không bị lỗi này vì
  là class định nghĩa ngay trong file (có runtime representation thật).
- `fixture-api/server.js` là JS thuần, không nằm trong TypeScript project
  của `backend/` — import nó vào `collection-runs.e2e-spec.ts` bằng `import`
  ESM dưới `"module": "nodenext"` sẽ vướng luật resolution nghiêm ngặt
  (bắt buộc extension tường minh, coi file là ESM/CJS theo `package.json`
  "type" của thư mục đó). Dùng thẳng `require()` (kiểu trả về `any` từ
  `@types/node`) thay vì `import` — né hoàn toàn việc tsc phải resolve
  `fixture-api/` như 1 phần của chương trình TS.
- Bug tự phát hiện lúc review lại test (chưa chạy được `test:e2e` thật để
  Jest tự bắt ra — thấy được thuần bằng đọc lại code): bản đầu của
  `collection-runs.e2e-spec.ts`, nhóm test "secret regression" tạo 1 API key
  RIÊNG rồi gán `process.env.FIXTURE_API_KEY = <key riêng đó>` trong
  `beforeEach`, nhưng KHÔNG restore lại sau đó. Vì instance `fixture-api`
  dùng chung cho cả file được khởi tạo 1 lần ở `beforeAll` với 1 key CỐ ĐỊNH
  (`RUN_TEST_API_KEY`), và `process.env` là state toàn cục theo process, key
  bị đổi này sẽ "rò" sang test B006 chạy SAU nó trong cùng file — B006 lúc
  đó sẽ gọi fixture-api với sai key thật (401), làm collection run FAILED
  thay vì SUCCESS như test mong đợi, dù logic collector hoàn toàn đúng. Sửa
  bằng cách bỏ hẳn key riêng, dùng lại `RUN_TEST_API_KEY` (key thật của
  fixture-api instance) cho cả nhóm test "secret regression" — vừa hết bug
  (không còn mutate `process.env` nữa), vừa để test này chạy hết đường happy
  path thật (500-once → retry → SUCCESS) thay vì fail sớm ở 401 như bản đầu.

**Quyết định phát sinh:**
- Retry KHÔNG lặp lại khi fixture-api trả 401 (`FixtureApiError.retryable =
  false`) — sai key/thiếu key không tự khỏi bằng cách gọi lại, retry chỉ có
  ý nghĩa với lỗi tạm thời (5xx, timeout, lỗi mạng). Đây là quyết định thiết
  kế riêng của phần collector, không phải điều `docs/plan-v4.md` yêu cầu cụ
  thể (plan chỉ nói "có retry", không nói retry mọi loại lỗi).
- `errorCount` trên 1 run SUCCESS (sau khi có ít nhất 1 lần fail trước đó)
  ghi lại **số lần fail trước khi thành công** (vd `500-once` → `errorCount
  = 1`), không phải 0 — tận dụng cột có sẵn để giữ thông tin "có trục trặc
  nhưng cuối cùng vẫn OK", thay vì chỉ 0/thành-công hoặc số-lần-fail/thất-bại.
- fixture-api's fault injection dùng header `x-attempt` do CLIENT tự set và
  tăng dần qua mỗi lần retry (không phải state phía server) — chọn cách này
  để fixture-api hoàn toàn stateless/deterministic, không có state ẩn giữa
  các request có thể gây flaky test khi nhiều test chạy liên tiếp trên cùng
  1 fixture-api instance (test Step 6 dùng chung 1 instance suốt cả file,
  không khởi tạo lại instance mỗi test case).
- `Source.config` cho fixture-api-backed source chỉ lưu **tên** biến môi
  trường chứa secret (`apiKeyEnvVar`), không lưu chính secret — đây là bất
  biến kiến trúc chính đảm bảo mục 4/5 của yêu cầu Step 6 (secret không lộ
  qua `POST /sources`/`GET /sources/:id`), không phải chỉ dựa vào lớp
  sanitize ở response. `sanitize-config.ts` là phòng thủ thêm (phòng
  trường hợp ai đó lỡ đưa secret thật vào `config` — test secret regression
  cố tình mô phỏng đúng tình huống sai này để chứng minh lớp phòng thủ có
  tác dụng thật, không chỉ đúng vì "chọn không lưu secret" nên trivially
  pass).
- Không thêm `class-validator`/`class-transformer` cho DTO (`CreateSourceDto`,
  `RunCollectionDto` chỉ là interface/class thường, không có runtime
  validation) — nhất quán với toàn bộ codebase hiện tại (chưa module nào
  dùng validation pipe), tránh thêm dependency mới ngoài phạm vi Step 6.

### Step 6 verify script — 2026-09-03

Thêm `scripts/verify-step6.sh` (`chmod +x`, `bash -n` sạch) gộp cả 3 việc
verify Docker của Step 6 (checklist bên dưới) thành 1 lệnh:
`npm run verify:step6` (từ `backend/`) hoặc `bash scripts/verify-step6.sh`
(từ gốc repo) — ghi toàn bộ bằng chứng thật vào
`step6-verification-<timestamp>.log` ở gốc repo, không chỉ tóm tắt
pass/fail. Không tự chạy được ở máy này (không có Docker) — chỉ viết +
`bash -n` + review theo route/type thật trong code, xem chi tiết trong
comment đầu file script.

### Step 6 — sửa 2 bug từ log Docker thật đầu tiên — 2026-09-03

Lần chạy `verify-step6.sh` đầu tiên trên máy có Docker báo FAILED, 2 bug
thật (bug thứ 3, Prisma `Unknown argument errorMessage`, đang xử lý riêng
qua `npx prisma migrate status`, KHÔNG đụng ở đây):
- **`fetch is not defined`**: `fixture-api-client.ts` gọi `fetch()` toàn
  cục — đổi sang `import { fetch } from 'undici'` (thêm `undici` vào
  `backend/package.json` dependencies) thay vì dựa vào global. Đã thử tái
  hiện offline bằng đúng config `npm run test:e2e` của repo này
  (`test/jest-e2e.json`, Jest 29.7.0) trên Node 24.16.0 ở máy này —
  **KHÔNG tái hiện được** (`fetch` có sẵn), nên chưa xác nhận được chính
  xác cơ chế/version nào gây lỗi thật trên máy Docker; global `fetch` của
  Node vẫn đang ở trạng thái experimental và là 1 global theo từng realm,
  không phải bảo đảm ngôn ngữ — dùng `undici` nhập tường minh loại bỏ hẳn
  sự phụ thuộc đó bất kể realm/version nào chạy code, không chỉ vá 1
  trường hợp cụ thể. Xem comment đầu `fixture-api-client.ts`.
- **`Cannot POST /sources` (404)**: kiểm tra lại kỹ — route trong
  `sources.controller.ts` (`@Controller('sources')` + `@Post()` không path)
  và `main.ts` (không `setGlobalPrefix`) đều đúng, route trong
  `verify-step6.sh` cũng đã đúng từ trước, **không có bug route trong
  code**. Nguyên nhân thật nhiều khả năng nhất: container `backend` lúc đó
  chạy image cũ (build trước khi `SourcesController` có handler thật ở
  Step 6 — bản cũ là `@Controller('sources')` rỗng, tự 404 mọi method).
  Sửa bằng cách thêm bước preflight vào script: `docker compose up -d
  --build` ép rebuild 3 service mỗi lần chạy, cộng vòng lặp chờ `GET
  /health` trả 200 trước khi vào 3 bước verify chính — loại bỏ nguyên lớp
  lỗi này thay vì dựa vào việc người chạy tự nhớ `--build`.

**Trạng thái: CHƯA verify lại thật** — cả 2 chỗ trên chỉ mới verify offline
(`tsc --noEmit`, `eslint`, `npm run test` sạch; `bash -n` sạch cho script;
`fetchFixtureEvents` đã smoke-test lại bằng `ts-node` thật gọi HTTP thật
tới `fixture-api/server.js` in-process — không cần Docker, xác nhận code
chạy đúng logic). Phải chạy lại `npm run verify:step6` trên máy Docker
thật để xác nhận cả 2 bug đã hết và log FAILED cũ không còn lặp lại.

### Step 6 — revert `undici`, quay lại global `fetch` — 2026-09-03

Entry trên (`import { fetch } from 'undici'`) tự nó gây ra 1 bug MỚI, xác
nhận qua log Docker thật lần 2: import `undici` (bản `8.10.1`, tự
`npm view undici version` lấy "latest" lúc thêm, không kiểm tương thích) là
`TypeError: webidl.util.markAsUncloneable is not a function` ném ra ngay
lúc LOAD module (không phải lúc gọi `fetch()`), làm crash đúng 2/3 e2e
suite: `app.e2e-spec.ts` và `collection-runs.e2e-spec.ts` (cả 2 import
`AppModule`/`CollectionRunsService`, kéo theo `fixture-api-client.ts` →
`undici`), còn `batch-lifecycle.e2e-spec.ts` (không import 2 thứ đó) thì
không sao — khớp chính xác pattern "2/3" trong log, đã verify lại bằng
`grep "^import"` trên cả 3 file (xem code review, không suy đoán). Cùng lúc
đó, log container backend THẬT (`node dist/main.js`, Node 22-alpine) cho
thấy chính đoạn `fetch()` đó chạy qua bình thường, không hề crash — nên đây
là vấn đề của riêng việc load package `undici` trong Jest `node` test
environment (1 vm context/realm khác với process chính), không phải fetch
tự nó có vấn đề.

**Quyết định: REVERT**, dựa trên bằng chứng thật, không suy đoán:
- `npm ls undici --all` → chỉ 1 bản `undici@8.10.1` trong toàn bộ cây phụ
  thuộc (dán output ở dưới) — nên đây KHÔNG phải va chạm 2 version của
  package `undici` cài qua npm. Duplicate thật sự là giữa package `undici`
  (mới thêm) và bản undici RIÊNG mà Node tự bundle nội bộ để cấp `fetch`
  global — cái đó không hiện trong `npm ls` vì nó không nằm trong
  `node_modules`, nó nằm trong chính Node runtime.
  ```
  $ npm ls undici --all
  backend@0.0.1 C:\Users\Admin\Desktop\celesnity-factory-platform\backend
  └── undici@8.10.1
  ```
- Dockerfile build log thật đã xác nhận `node:22-alpine` — Node 22 có
  `fetch` global ổn định (hết "experimental" từ Node 21), không cần
  dependency ngoài. Entry trước ghi "Node's global fetch vẫn đang ở trạng
  thái experimental" — sai, không kiểm lại kỹ trước khi viết; sửa lại ở
  đây cho đúng.
- Nguyên nhân THẬT của lỗi "fetch is not defined" ban đầu (Lỗi 2, entry
  trước) và "Cannot POST /sources" (Lỗi 3) rất có thể là CÙNG 1 nguyên
  nhân đã xác nhận cho Lỗi 3: container `backend` chạy image cũ, build
  trước khi có code Step 6 — không liên quan gì tới fetch có tồn tại hay
  không. `scripts/verify-step6.sh` đã có bước preflight rebuild (`docker
  compose up -d --build` + chờ `/health` 200) giải quyết đúng nguyên nhân
  này rồi — không cần workaround riêng cho fetch nữa.
- Đã xoá `undici` khỏi `backend/package.json` (`npm uninstall undici`),
  `fixture-api-client.ts` quay lại dùng thẳng `fetch` global (không import
  gì thêm) — xem comment đầu file để biết đầy đủ lý do, tránh ai đó đọc
  code sau này lại "sửa lại" giống lần trước.

Verify offline sau khi revert: `tsc --noEmit`/`eslint`/`npm run test`
(22/22) đều sạch; thêm 1 probe tạm (`test/zz-module-load-probe.e2e-spec.ts`,
đã xoá sau khi verify) chạy qua đúng config `test/jest-e2e.json` — xác nhận
import `fixture-api-client.ts` + `AppModule` không còn crash lúc load
module nữa (không cần Postgres cho việc này, chỉ là import).

**Trạng thái: VẪN "CHƯA verify lại thật"** — chỉ mới verify offline như
trên. Phải chạy lại `npm run verify:step6` trên máy Docker thật mới biết
chắc cả 3 lỗi (fetch/undici, routing 404, và lỗi Prisma `error_message`
đang xử lý riêng) đã hết thật hay chưa.

### Step 6 — HOÀN TẤT, verify thật trên Postgres thật — 2026-09-03

`npm run verify:step6` chạy PASS thật trên máy có Docker, sau chuỗi debug ở
3 entry phía trên cộng 1 vấn đề migration phát hiện thêm (dưới đây). Toàn
bộ Step 6 (collector Application API thật, fault injection, retry, secret
handling, script verify 1-lệnh) coi như xong và đã verify thật, không chỉ
offline nữa.

**Đã làm (tổng hợp lại đầy đủ, không chỉ trỏ ngược về entry cũ):**
- `fixture-api/` — mock "Application API", plain Node `http` không
  dependency, endpoint `GET /events` yêu cầu `x-api-key`, trả cố định 2
  record DISPATCH (B006 quantity 480, B008 quantity 97) đúng
  `docs/plan-v4.md` §3, có fault injection qua query param/env
  (`none`/`500-once`/`500-always`/`timeout`), stateless (dùng header
  `x-attempt` client tự tăng, không giữ state phía server).
- Fault injection + retry logic thật trong `CollectionRunsService.
  runCollection()`: retry tối đa 3 lần, backoff `50ms * 2^n`, timeout 2s/
  request, không retry khi 401 (`retryable: false`). Ghi đúng 1 row
  `collection_runs` (RUNNING → SUCCESS|FAILED) mỗi lần chạy.
- Secret handling: `Source.config` chỉ lưu TÊN biến môi trường chứa API
  key (`apiKeyEnvVar`), không bao giờ lưu giá trị secret thật; secret thật
  chỉ đọc từ `process.env` lúc gọi, không bao giờ ghi xuống DB/log/response
  (`sanitize-config.ts` là lớp phòng thủ thêm ở response).
- `scripts/verify-step6.sh` — gộp preflight rebuild (`docker compose up -d
  --build` + chờ `/health` 200) + `docker compose ps` + `npm run test:e2e`
  đầy đủ + 1 lần gọi thật `POST /collection-runs` với `fault=500-once` +
  tail log container `backend` cùng lúc, tất cả ghi vào 1 file log thật,
  chạy qua `npm run verify:step6`.
- Migration baselining (Prisma): xem "Vấn đề gặp phải" bên dưới — đưa
  `backend/prisma/migrations/` (trước đó không tồn tại trong git, dù DB Step
  2 đã có sẵn 9 bảng) về đúng trạng thái baseline khớp DB thật, để migration
  mới của Step 6 (`error_message`) áp dụng được mà không phải drop/tạo lại
  DB.

**Vấn đề gặp phải (trình tự thật, đầy đủ 3 lần debug + 1 vấn đề migration):**
1. **`docker compose ps`/`POST /sources` → 404 "Cannot POST /sources"**
   (lần chạy `verify-step6.sh` đầu tiên). Route trong
   `sources.controller.ts`/`main.ts` đều đúng (đã grep kỹ, xem entry "sửa 2
   bug" phía trên) — nguyên nhân thật: container `backend` đang chạy image
   cũ, build TRƯỚC KHI `SourcesController` có handler thật ở Step 6 (bản cũ
   là `@Controller('sources')` rỗng, tự 404 mọi method). Sửa bằng preflight
   `docker compose up -d --build` trong script.
2. **Cùng lần đó, nghi vấn "fetch is not defined"** dẫn tới quyết định SAI:
   đổi `fetch()` toàn cục sang `import { fetch } from 'undici'`. Quyết định
   này dựa trên suy đoán chưa kiểm chứng đủ ("Node global fetch vẫn
   experimental") — sau này xác nhận sai (Node 22, base image thật của
   `backend/Dockerfile`, có `fetch` stable từ lâu). Việc đổi sang `undici`
   còn gây ra bug MỚI: `TypeError: webidl.util.markAsUncloneable is not a
   function`, crash 2/3 e2e suite ngay lúc load module. Đã REVERT lại dùng
   `fetch` global, xoá `undici` khỏi `package.json` — xem 2 entry phía trên
   ("sửa 2 bug" và "revert undici") cho toàn bộ chi tiết + bằng chứng
   (`npm ls undici --all`, `grep "^import"` trên 3 file e2e). Nguyên nhân
   thật của "fetch is not defined" ban đầu, nhìn lại, nhiều khả năng CŨNG
   là do image cũ ở mục 1 — không liên quan gì đến fetch có tồn tại hay
   không.
3. **Migration history của Step 2 (`init_schema`) chưa từng được `git
   add`/commit** — phát hiện khi thêm cột `collection_runs.error_message`
   (Step 6) và chạy `npx prisma migrate dev` trên máy Docker: Prisma báo
   `Unknown argument errorMessage`/lỗi migration history không khớp, vì DB
   thật đã có sẵn 9 bảng từ Step 2 (áp dụng lúc đó, đúng như checklist Step
   2 đã tick) nhưng thư mục `backend/prisma/migrations/` chứa lịch sử
   migration đó chưa bao giờ được commit vào git (repo này chỉ có
   `schema.prisma` + `seed.ts` trong `backend/prisma/`, xác nhận qua `git
   ls-files backend/prisma`) — nên khi pull code sang máy Docker, Prisma
   không thấy migration history nào để so khớp với DB thật đã tồn tại sẵn,
   dẫn đến lệch trạng thái. Xử lý bằng **baselining**: dùng `prisma migrate
   diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
   để sinh lại đúng 1 migration SQL khớp schema hiện tại, rồi `prisma
   migrate resolve --applied <tên migration>` để đánh dấu migration đó là
   "đã áp dụng" mà KHÔNG chạy lại SQL (DB thật đã có sẵn đúng cấu trúc đó
   rồi, chạy lại sẽ lỗi trùng bảng/cột) — **không mất data thật** nào trong
   quá trình này. Bài học: `backend/prisma/migrations/` phải được `git add`
   ngay từ lần `migrate dev` đầu tiên (Step 2), không phải việc có thể để
   sau; chưa sửa lại lịch sử Step 2 trong README này (đúng chủ trương không
   viết lại lịch sử, chỉ ghi nhận ở đây khi phát hiện).

**Bằng chứng log thật (retry xảy ra đúng, kết quả cuối đúng kỳ vọng, trích
nguyên văn):**
```
celesnity-backend | ... WARN [CollectionRunsService] Collection run
8373a671-... (source 27b6cf50-...) attempt 1/3 failed: fixture API
returned 500
POST /collection-runs response: {"id":"8373a671-...","status":"SUCCESS",
"recordsRead":2,"errorCount":1,"errorMessage":null,...}
```
Đọc đúng: attempt 1/3 thất bại vì fixture-api trả 500 (fault injection
`500-once`), retry, attempt 2 thành công → `status: SUCCESS`,
`recordsRead: 2`, `errorCount: 1` (đúng 1 lần fail trước khi thành công,
khớp thiết kế ở `collection-runs.service.ts`), `errorMessage: null` (không
có lỗi cuối cùng vì run kết thúc SUCCESS).

`npm run test:e2e`: **22/22 pass thật** — 14 case
`batch-lifecycle.e2e-spec.ts` (10 scenario `test.each` + idempotent
recompute + recompute xét đủ lịch sử + B006 ACK_EXCEPTION + NotFoundException)
+ 7 case `collection-runs.e2e-spec.ts` (2 fault injection `test.each` + 3
secret-endpoint `test.each` + 1 secret-log + 1 B006 end-to-end) + 1 case
`app.e2e-spec.ts`.

**Việc chưa xong, chưa chặn tiến độ, ghi lại để không quên:**
- Jest in cảnh báo `Jest did not exit one second after the test run has
  completed. This usually means there are asynchronous operations that
  weren't stopped... Consider running Jest with --detectOpenHandles` sau
  khi `test:e2e` đã pass hết. Nghi ngờ (chưa xác nhận): `PrismaService`
  hoặc HTTP agent (`fetch`/connection keep-alive tới fixture-api) chưa được
  đóng đúng ở cuối 1 số `afterAll`/`afterEach`. Không ảnh hưởng kết quả
  pass/fail, chỉ là process không tự thoát gọn — để lại làm sau, chưa sửa.
- Mỗi lần chạy `verify-step6.sh`, script tự tạo 1 `Source` mới qua `POST
  /sources` (để lấy `sourceId` thật cho lần gọi fault-injection thủ công ở
  bước 3) nhưng không xoá lại — mỗi lần chạy để lại 1 row rác trong DB dev.
  Không ảnh hưởng tính đúng đắn của lần verify (mỗi lần vẫn tạo Source mới,
  độc lập), chỉ là rác tích luỹ trong DB dev theo thời gian — chưa dọn.

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
- [x] **`docker compose up --build`, sau đó `cd backend && npm run
      test:e2e`** — đã pass thật, cả `batch-lifecycle.e2e-spec.ts` (14 case)
      và `app.e2e-spec.ts` (1 case), là 1 phần của lần chạy `npm run
      verify:step6` — xem entry "Step 6 — HOÀN TẤT, verify thật trên
      Postgres thật" bên trên cho bằng chứng log thật.
- [x] **Step 6 — đã verify thật.** Trình tự thật khác với dự tính ban đầu ở
      đây một chút — migration cho `collection_runs.error_message` KHÔNG
      chạy được bằng `npx prisma migrate dev` thẳng, vì migration history
      của `init_schema` (Step 2) chưa từng được commit vào git; phải
      baseline lại (`prisma migrate diff --from-empty` + `prisma migrate
      resolve --applied`) trước — xem chi tiết đầy đủ ở "Vấn đề gặp phải"
      trong entry "Step 6 — HOÀN TẤT, verify thật trên Postgres thật" bên
      trên. Sau đó `npm run verify:step6` chạy PASS thật (22/22 test:e2e),
      bằng chứng retry thật đã dán trong entry đó — không lặp lại ở đây.
