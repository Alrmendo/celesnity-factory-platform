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

## Assessment Assumptions

- Hạ tầng "Production Database" (Step 7, nguồn DATABASE trong Rule 4) là
  **service Postgres riêng trong `docker-compose.yml`** (`production-db`,
  port host 5434) — không phải MySQL. Đề bài gốc chỉ nói "a locally hosted
  PostgreSQL or MySQL database provided through Docker Compose" mà không
  chỉ định cụ thể công nghệ; đây là quyết định thiết kế tự đặt ra (đã dừng
  lại hỏi người dùng xác nhận qua `AskUserQuestion` trước khi code — xem
  entry "Step 7" trong Nhật ký triển khai bên dưới).
- Route shape cho Management Events (Step 9) — `POST
  /management-events/block|resume|ack-exception|note`, body `{ batchId,
  actor, note? }` — là thiết kế tự đặt ra. Không có REST contract cụ thể
  nào cho phần này trong `docs/plan-v4.md` (chỉ ghi "REST contract khung
  của v3 vẫn giữ nguyên", nhưng `celesnity-assessment-plan-v3.md` không
  tồn tại trong repo — đã xác nhận lại) lẫn trong đề bài gốc (PDF, mục
  "Management Events" chỉ liệt kê 4 hành động bắt buộc, không có route/
  request shape). Xem entry "Step 9" trong Nhật ký triển khai bên dưới.
- Route đọc cho UI (Step 10) — `GET /canonical-events` (preview
  "normalized record" kèm provenance) thay vì `GET /source-records` như
  gợi ý trong prompt Step 10, và `GET /production-lines` trả toàn bộ line
  trong 1 lần gọi thay vì `GET /lines/:id/status` theo từng line — cả hai
  đều là thiết kế tự đặt ra, prompt cho phép "hoặc endpoint tương đương".
  Xem entry "Step 10" trong Nhật ký triển khai bên dưới.

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
- Step 7 **HOÀN TẤT, đã verify THẬT trên Postgres thật (2 instance)** — xem
  entry "Step 7 — HOÀN TẤT, verify thật trên Postgres thật" (entry cuối
  cùng của chuỗi Step 7 bên dưới, có bằng chứng log thật): collector
  "Production Database" thật — service Postgres riêng (`production-db/`,
  tách biệt hoàn toàn với `postgres` — nguồn dữ liệu ngoài thật sự, không
  phải schema phụ trong cùng DB), full register→verify→discover→select→
  collect qua `SourcesController`/`CollectionRunsService`, DB collector
  KHÔNG retry (đúng phạm vi đề bài gốc — "Retry of transient failures" chỉ
  áp dụng cho Application API), secret handling cùng pattern Step 6.
- Step 8 **HOÀN TẤT, đã verify THẬT trên Docker thật (5/5 suite, 38/38
  test)** — xem entry "Step 8 — HOÀN TẤT, verify thật trên Docker thật"
  (entry cuối cùng của chuỗi Step 8 bên dưới, có bằng chứng log thật):
  collector "Supplier Crawler" thật — service `supplier-portal` mới (HTML
  thật, phân trang, fault injection malformed-row/pagination-loop), crawl
  qua regex parser tự viết (không thêm dependency HTML-parsing ngoài),
  pagination loop protection (visited-URL set + hard cap 50 trang),
  malformed row bị skip + ghi log/errorCount mà KHÔNG fail cả run, mọi
  record crawl được gán cứng station RECEIVING, KHÔNG retry (đúng đề bài
  gốc — chỉ Application API cần retry), KHÔNG có secret (portal công
  khai, không auth).
- Step 9 **HOÀN TẤT, đã verify THẬT trên Docker thật (6/6 suite, 52/52
  test)** — xem entry "Step 9" bên dưới (đã cập nhật với bằng chứng log
  thật): `ManagementEventsModule` ghi thật —
  4 action (BLOCK/RESUME/ACK_EXCEPTION/ADD_NOTE) qua `POST
  /management-events/*`, append-only tuyệt đối (chỉ `.create()`, không có
  route/method nào update/xoá), luôn có `organizationId`/`actor`/
  `timestamp` thật. Logic derive `acknowledged` (Rule 5b) và đọc
  `management_events` cho batch state (Rule 7 — BLOCKED) **đã có sẵn từ
  Step 5**, không phải code mới — Step 9 chỉ thêm phần GHI còn thiếu.
- Step 10 **HOÀN TẤT, đã verify THẬT trên Docker thật (7/7 suite, 59/59
  test — gồm cả phần bổ sung `lastEventAt`/provenance links)** — xem entry
  "Step 10" bên dưới (đã cập nhật với bằng chứng log/curl thật): read API
  cho UI — `GET /sources` (list), `GET /collection-runs?sourceId=` (lịch
  sử + duration), `GET /canonical-events?batchId=&sourceId=&collectionRunId=`
  (preview normalized record + provenance), `GET /production-lines`
  (rollup theo line/station, WIP, freshness, `lastEventAt`,
  `contributingSourceRecordIds`/`contributingCollectionRunIds` — tái sử
  dụng nguyên `ProductionDomainService.getBatchStatus`, không viết lại
  logic domain). `STALE_THRESHOLD_MINUTES` (env var, default 15) giờ
  configurable. Chỉ backend — chưa có code frontend.
- Step 11 (frontend, **build sạch — CHƯA tự click-test trên trình duyệt
  thật**, máy này không có Docker; xem entry "Step 11" bên dưới): Data
  Sources view (`frontend/app/sources/`, `frontend/app/canonical-events/`)
  — register/verify/discover/select/run collection/lịch sử/preview
  provenance, gọi thẳng các endpoint Step 6–10 qua `lib/api.ts`.
- **Chưa làm**: Production Lines view (Step 12) — bước tiếp theo sau
  Step 11.

Backend là modular monolith NestJS, 5 module nghiệp vụ:

- `SourcesModule` — `POST /sources`, `GET /sources` (list, Step 10), `GET
  /sources/:id` (Step 6); `POST /sources/:id/verify`, `GET
  /sources/:id/discover` (Step 7 DATABASE + Step 8 CRAWLER, dispatch theo
  `source.type` trong `SourcesService`), `POST /sources/:id/select` (Step
  7, DATABASE only — CRAWLER không có bước select vì chỉ có đúng 1
  deliveries feed, không có gì để chọn); config JSON không bao giờ chứa
  secret literal, sanitize thêm 1 lớp phòng thủ ở response (xem
  `sanitize-config.ts`)
- `CollectionRunsModule` — `POST /collection-runs`, `GET
  /collection-runs?sourceId=` (lịch sử + `durationMs`, Step 10), `GET
  /collection-runs/:id` (Step 6); reuse nguyên
  `CanonicalizationService.ingestBatch` để insert + recompute. Dispatch
  theo `source.type`: `API` → gọi fixture-api thật, có retry/backoff (Step
  6); `DATABASE` → query bảng đã chọn trên `production-db` thật, không
  retry (Step 7); `CRAWLER` → crawl `supplier-portal` thật (phân trang,
  pagination-loop protection, malformed row bị skip không fail run), gán
  cứng station RECEIVING, không retry (Step 8, đúng phạm vi đề bài —
  "Retry of transient failures" chỉ yêu cầu cho Application API)
- `CanonicalizationModule` — có pipeline Rule 1–5b + wiring Prisma thật;
  `GET /canonical-events?batchId=&sourceId=&collectionRunId=` (Step 10) —
  preview canonical event kèm provenance (source_records → sources)
- `ProductionDomainModule` — có logic Rule 6–7 + wiring Prisma thật; `GET
  /production-lines` (Step 10, `ProductionLinesController` mới) — rollup
  theo line (từ `WorkOrder.lineId`, không phải bảng `lines`), per-station
  WIP, tái sử dụng `getBatchStatus` không sửa
- `ManagementEventsModule` — `POST /management-events/block|resume|
  ack-exception|note` (Step 9), append-only (chỉ `.create()`), luôn gắn
  `organizationId` (seeded, `SEED_ORGANIZATION_ID`)/`actor` (từ caller)/
  `timestamp` (server, `new Date()`, không tin client). `resume` reuse
  `resolveIsBlocked` (Step 4, batch-state.ts) để từ chối resume khi chưa
  bị block; `ack-exception` từ chối khi batch không có canonical event
  CONFLICT nào

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

### Step 7 — 2026-09-03

**Trạng thái: HOÀN TẤT — đã verify THẬT trên Postgres thật (2 instance).**
(Lúc viết entry này, dòng trạng thái ghi "code xong, verify OFFLINE pass —
CHƯA verify Docker thật (máy này không có Docker chạy được), chờ máy có
Docker" — đã lỗi thời từ khi đó; xem entry **"Step 7 — HOÀN TẤT, verify
thật trên Postgres thật"** ở cuối chuỗi entry Step 7 bên dưới để xem toàn
bộ quá trình verify thật + bằng chứng log thật cuối cùng.)

**Kiểm tra kiến trúc bắt buộc trước khi code (theo yêu cầu của prompt Step
7) — kết quả:**
- `docs/plan-v4.md`: grep toàn file cho "production database"/"mysql" chỉ
  ra đúng 1 chỗ — Rule 4 (dòng 30), nhắc "Production Database" thuần tuý
  như TÊN 1 nguồn Tier 1 trong logic conflict-resolution, không hề nói gì
  về hạ tầng (service riêng hay schema phụ trong DB hiện có).
- `docker-compose.yml` (trước khi sửa): đúng 4 service — `postgres`
  (canonical data của chính backend), `backend`, `fixture-api`, `frontend`.
  Không service nào đóng vai trò "production database" — xác nhận nghi
  ngờ ban đầu là đúng.
- Không có `plan-v3.md` nào trong repo để đối chiếu thêm (plan-v4.md chỉ
  nhắc tên file đó, chưa từng được commit).
- Phát hiện thêm lúc kiểm: `docs/HANDOFF.md` (file tồn tại nhưng **chưa
  từng được `git add`** — thấy qua `git status`, giống đúng cạm bẫy #11 đã
  ghi lại trong chính file đó) và
  `docs/Celesnity Technical Take-Home Assessment — 2026 (1).pdf` (**đề bài
  gốc**, cũng chưa `git add`) — đọc trực tiếp PDF này để lấy đúng bảng
  mapping station→source thay vì tin theo paraphrase trong prompt: xác
  nhận đúng 100% — SORTING/WASHING/DRYING/FOLDING → Production database;
  RECEIVING → Supplier crawler (Step 8, không phải Production Database);
  DISPATCH → Application API hoặc production database. PDF cũng xác nhận
  "Retry of transient failures" chỉ được yêu cầu cho Application API (mục
  1), không có cho Database Connection (mục 3) — dùng làm căn cứ cho quyết
  định KHÔNG thêm retry loop ở DB collector bên dưới.
- **Đây là quyết định kiến trúc chưa có sẵn** → đã dừng lại, dùng
  `AskUserQuestion` hỏi trước khi code, theo đúng yêu cầu của prompt.
  Người dùng chọn: **service Postgres riêng trong `docker-compose.yml`**
  (không phải schema phụ trong `postgres` hiện có, không phải MySQL) — lý
  do đã trình bày: trung thực nhất với "a locally hosted PostgreSQL or
  MySQL database provided through Docker Compose", mirror đúng pattern
  `fixture-api/` đã dùng ở Step 6, tái dùng được driver `pg` đã có sẵn
  trong repo (không cần dependency mới).

**Đã làm:**
- `production-db/` (top-level, ngang hàng `backend/`/`fixture-api/`/
  `frontend/`) — chỉ 1 file `init.sql`, KHÔNG có Dockerfile riêng (dùng
  thẳng image `postgres:16-alpine` chính thức qua
  `/docker-entrypoint-initdb.d/`, mount read-only trong `docker-compose.yml`
  — đơn giản hơn cả `fixture-api/`, không cần build gì).
  - `station_readings`: bảng "production table" thật, cột `id, batch_id,
    station, quantity, event_time`, seed data cho `SORTING/WASHING/DRYING/
    FOLDING` (đúng bảng mapping đề bài gốc, xem trên) trên 2 batch riêng
    (`PDB-B001`, `PDB-B002` — namespace riêng, cố tình khác `B001–B008` của
    `batch-scenarios.ts` vì đây là 2 hệ fixture độc lập).
  - `machines`, `employees`: bảng decoy, không liên quan collection — để
    "discover tables" + "select ĐÚNG 1 bảng" có ý nghĩa thật (có nhiều hơn
    1 bảng để chọn), không phải chọn giữa 1 lựa chọn duy nhất.
  - `docker-compose.yml`: service `production-db` (port host 5434), volume
    riêng `production_db_data`, healthcheck `pg_isready`; `backend` thêm
    `PRODUCTION_DB_PASSWORD`, `depends_on` `production-db` healthy.
- `backend/prisma/schema.prisma`: thêm cột `Source.verifiedAt` (nullable
  `DateTime`) — verify THÀNH CÔNG mới cập nhật cột này; verify THẤT BẠI cố
  tình không đụng vào (không có "trạng thái lỗi" riêng, chỉ có "lần verify
  thành công gần nhất" hoặc null).
- `database-source-client.ts` (mới, `collection-runs/`, mirror
  `fixture-api-client.ts`): `verifyConnection`/`discoverSchema`/
  `collectFromTable` dùng thẳng driver `pg` (KHÔNG dùng Prisma — Prisma
  Client bị khoá schema tại thời điểm `generate`, không introspect runtime
  được, mà "Discover available tables and columns" theo đúng câu chữ đề
  bài đòi hỏi introspect thật qua `information_schema`). `collectFromTable`
  validate `tableName` bằng regex identifier
  (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) trước khi nhét vào SQL — phòng thủ SQL
  injection dù về lý thuyết giá trị này luôn đến từ `selectTable()` (đã tự
  validate lại qua 1 lần `discoverSchema()` thật trước khi lưu, không tin
  thẳng input client).
- `SourcesService`: thêm `verifyConnection`/`discoverSchema`/`selectTable`
  (chỉ áp dụng source type `DATABASE`, ném `BadRequestException` nếu gọi
  nhầm type khác). `selectTable` re-verify `table` có thật trong kết quả
  `discoverSchema()` mới nhất trước khi lưu vào `config.selectedTable` —
  không tin thẳng tên bảng client gửi lên.
- `SourcesController`: thêm `POST /sources/:id/verify`, `GET
  /sources/:id/discover`, `POST /sources/:id/select`.
- `CollectionRunsService.runCollection()`: tách logic cũ (Step 6) ra
  `runApiCollection` (nguyên si, không đổi 1 dòng logic), thêm
  `runDatabaseCollection` cho source type `DATABASE` — query bảng đã chọn,
  map row → `NewSourceRecordInput[]`, gọi thẳng
  `CanonicalizationService.ingestBatch()` (Step 5, nguyên si, không viết
  lại). **Không có retry loop** cho nhánh DATABASE (khác Step 6's API
  collector) — đúng phạm vi đề bài gốc (xem mục kiểm tra kiến trúc ở trên).
- `backend/test/database-collector.e2e-spec.ts` (Step 7, DB thật — CẦN
  CẢ 2 Postgres, `postgres` lẫn `production-db`, không tự host in-process
  được như `fixture-api` vì đây là Postgres thật, không phải script JS):
  `test.each` verify connection (đúng credential → thành công +
  `verifiedAt` cập nhật; sai password → thất bại + `verifiedAt` không đổi);
  discover trả đúng ≥ 3 bảng thật kèm cột đúng; select + collect →
  `canonical_events`/`source_records` đúng qua `ingestBatch()` thật (assert
  `PDB-B001:WASHING` = 98, `ACCEPTED`); collect khi chưa select → throw,
  không crash app (`GET /health` vẫn 200 sau đó); secret regression
  `test.each` 3 endpoint + 1 log check (cùng pattern Step 6, cố tình đưa
  literal password vào `config` để test lớp redact có tác dụng thật).

**Vấn đề gặp phải:**
- **Bug tự phát hiện lúc review lại code trước khi coi là xong** (chưa
  chạy `test:e2e` thật để Jest tự bắt — thấy bằng cách tự hỏi "tsc có thật
  sự đang kiểm tra đoạn này không" sau khi thấy `tsc --noEmit` sạch một
  cách đáng ngờ cho 1 đoạn code có vẻ sai kiểu): `runDatabaseCollection`
  khai báo `let rows;` KHÔNG type annotation — vì `noImplicitAny: false`
  trong `tsconfig.json`, biến này bị suy ra ngầm thành `any`, kéo theo cả
  chuỗi `.filter().map()` sau đó cũng thành `any`, khiến TypeScript hoàn
  toàn không kiểm tra được việc gán `row.station` (kiểu `string` từ DB)
  vào field `station: Station` (union literal) của `NewSourceRecordInput`
  — lẽ ra phải là lỗi biên dịch thật. Xác nhận bằng cách viết lại y hệt
  đoạn code trong 1 file `.ts` cô lập bên ngoài project (không có
  `noImplicitAny: false`) → lỗi hiện ra đúng như kỳ vọng; rồi dùng thẳng
  TypeScript Compiler API (`ts.createProgram` + `getTypeAtLocation`) để in
  ra kiểu THẬT mà compiler suy luận cho biến `records` ngay trong chính
  file thật của repo → thấy rõ `any` thay vì kiểu object mong đợi, xác
  nhận đúng nguyên nhân trước khi sửa. Sửa bằng cách thêm annotation tường
  minh `let rows: ProductionTableRow[];`, và thêm `as Station` có chú
  thích rõ lý do an toàn (đã lọc qua `isStationValue` ở bước `.filter()`
  ngay trước đó — TypeScript không tự carry được narrowing qua 1 arrow
  function bọc ngoài type guard, đây là giới hạn biết trước của ngôn ngữ,
  không phải chỗ nào cũng tự suy luận được). Bài học: khi thấy `tsc --noEmit`
  sạch cho 1 đoạn code có `let x;` không type annotation, luôn nghi ngờ và
  kiểm tra kiểu suy ra thật, đừng chỉ tin "0 lỗi" là code đã type-safe thật
  sự — `noImplicitAny: false` (đã bật từ Step 1, xem lý do gốc trong
  README) có thể che giấu đúng loại bug này.
- Không verify được cú pháp SQL thật của `production-db/init.sql` qua
  `psql`/Postgres thật — máy này không có `psql` cài sẵn và không có
  Docker. Chỉ review bằng mắt (cú pháp SQL chuẩn, đơn giản: `CREATE TABLE`/
  `INSERT` cơ bản, không dùng tính năng Postgres nào đặc biệt) — **CHƯA
  verify chạy thật**, nằm trong Phần B.

**Quyết định phát sinh:**
- `Source.config` cho DATABASE source theo đúng pattern Step 6: chỉ lưu
  **tên** biến môi trường chứa password (`passwordEnvVar`), không lưu
  password thật. Khác Step 6 ở chỗ `host`/`port`/`database`/`user` (không
  phải secret) được cung cấp trực tiếp trong `config` lúc `POST /sources`
  — không cần biến môi trường tĩnh riêng cho từng phần này (khác
  `FIXTURE_API_BASE_URL` cố định của Step 6), vì mỗi Source DATABASE có
  thể trỏ tới 1 DB khác nhau, không có "1 địa chỉ cố định" như fixture-api.
- Không thêm retry/backoff cho `runDatabaseCollection` — đề bài gốc (đã
  đọc trực tiếp PDF, xem mục kiểm tra kiến trúc) chỉ yêu cầu "Retry of
  transient failures" cho Application API (mục 1), không nhắc gì tương tự
  cho Database Connection (mục 3). Thêm retry ở đây sẽ là suy diễn vượt
  phạm vi đề, không phải yêu cầu thật.
- `selectTable()` gọi lại `discoverSchema()` thật (tốn thêm 1 round-trip
  query) thay vì tin thẳng tên bảng client gửi lên — đánh đổi hiệu năng
  nhỏ lấy đảm bảo: không bao giờ lưu 1 `selectedTable` không tồn tại, và
  không bao giờ để tên bảng chưa qua introspect thật lọt vào
  `collectFromTable`'s SQL.
- `production-db/init.sql` seed 2 bảng decoy (`machines`, `employees`)
  không phục vụ collection gì — cố ý, để bước "discover" + "select" có ý
  nghĩa thật (nhiều hơn 1 lựa chọn), không phải hình thức vì DB chỉ có
  đúng 1 bảng.
- Batch id trong `production-db/init.sql` (`PDB-B001`, `PDB-B002`) cố tình
  KHÔNG trùng với `B001–B008` của `batch-scenarios.ts` — 2 hệ fixture độc
  lập (1 cái là DB ngoài thật để Step 7 collector query, 1 cái insert
  thẳng qua Prisma để test canonicalization Step 3–6), không có lý do gì
  phải dùng chung batch id.

### Step 7 — HOÀN TẤT, verify thật trên Postgres thật — 2026-09-03

`npm run test:e2e` chạy PASS thật trên máy có Docker, cả 4 suite e2e của
toàn repo — 31/31 test pass, gồm `database-collector.e2e-spec.ts` (Step 7)
chạy trên **2 instance Postgres thật riêng biệt**: `postgres` (canonical
data của chính backend) và `production-db` (mới, nguồn Database, mirror
pattern `fixture-api` của Step 6). Toàn bộ luồng register→verify→discover→
select→collect đã chạy thật, kèm secret regression cho nguồn DATABASE.
Step 7 coi như xong và đã verify thật, không chỉ offline nữa.

**Đã làm (tổng hợp lại đầy đủ, không chỉ trỏ ngược về entry cũ):**
- Quyết định kiến trúc: service Postgres riêng `production-db` trong
  `docker-compose.yml` (không phải schema phụ trong `postgres` hiện có,
  không phải MySQL) — mirror đúng pattern `fixture-api/` đã dùng ở Step 6.
- Seed sẵn `station_readings` (bảng "production table" thật, dữ liệu
  SORTING/WASHING/DRYING/FOLDING đúng bảng mapping đề bài gốc) + 2 bảng
  decoy (`machines`, `employees`) trong `production-db/init.sql`, để bước
  "discover tables" + "select đúng 1 bảng" có ý nghĩa thật.
- `database-source-client.ts` dùng lại thẳng driver `pg` (không dùng
  Prisma — Prisma Client bị khoá schema tại thời điểm `generate`, không
  introspect runtime được, mà "Discover available tables and columns" theo
  đúng câu chữ đề bài đòi hỏi introspect thật qua `information_schema`).
- Cột `Source.verifiedAt` mới (nullable `DateTime`) — chỉ verify thành
  công mới cập nhật.
- Luồng register→verify→discover→select→collect đầy đủ qua
  `SourcesController` (`POST /sources/:id/verify`, `GET
  /sources/:id/discover`, `POST /sources/:id/select`) và
  `CollectionRunsService.runDatabaseCollection`.
- DB collector **KHÔNG retry** — đúng phạm vi đề bài gốc (đã đọc trực tiếp
  PDF: "Retry of transient failures" chỉ được yêu cầu cho Application API,
  mục 1; không có yêu cầu tương tự cho Database Connection, mục 3).
- Secret handling theo đúng pattern Step 6: `Source.config` chỉ lưu tên
  biến môi trường chứa password (`passwordEnvVar`), không bao giờ lưu
  password thật; `sanitize-config.ts` redact thêm 1 lớp phòng thủ ở
  response.

**Vấn đề gặp phải (trình tự thật):**
1. `docs/plan-v4.md` không định nghĩa hạ tầng "Production Database" (chỉ
   nhắc tên nguồn Tier 1 trong Rule 4, không nói gì về service riêng hay
   schema phụ) — phải đọc lại đề bài gốc (PDF) để xác nhận đúng yêu cầu và
   bảng mapping station→source trước khi code (chi tiết đầy đủ đã ghi
   trong entry Step 7 gốc bên trên).
2. Đây là quyết định kiến trúc chưa có sẵn (Postgres riêng vs MySQL) →
   dừng lại, dùng `AskUserQuestion` hỏi người dùng trước khi code, thay vì
   tự chọn.
3. Bug tự phát hiện lúc review lại code trước khi báo cáo là xong (chưa
   chạy `test:e2e` thật để Jest tự bắt ra): `runDatabaseCollection` khai
   báo `let rows;` thiếu type annotation, ngầm thành `any` do
   `noImplicitAny: false` — sửa bằng annotation tường minh trước khi báo
   cáo. Xác nhận bằng TypeScript Compiler API (`ts.createProgram` +
   `getTypeAtLocation`) in ra kiểu thật compiler suy luận, chứ không chỉ
   tin `tsc --noEmit` sạch là đủ (bài học lặp lại từ Step 3).
4. **Lần chạy `npm run test:e2e` đầu tiên trên máy Docker thật FAIL** —
   thiếu biến môi trường `PRODUCTION_DB_PASSWORD` trong `backend/.env`.
   Đúng cơ chế secret của Step 6 (`Source.config` chỉ lưu TÊN biến
   env, không lưu giá trị), nhưng biến đó chưa được set trên máy chạy
   test. Set đúng giá trị vào `backend/.env` (không commit, file đã
   gitignore) rồi chạy lại → 31/31 pass.

**Bằng chứng log thật (`npm run test:e2e`, dán nguyên văn):**
```
PASS test/database-collector.e2e-spec.ts
PASS test/batch-lifecycle.e2e-spec.ts
PASS test/collection-runs.e2e-spec.ts
PASS test/app.e2e-spec.ts

Test Suites: 4 passed, 4 total
Tests:       31 passed, 31 total
```

**Việc chưa xong, chưa chặn tiến độ, ghi lại để không quên:**
- Cảnh báo `Jest did not exit one second after the test run has completed.
  This usually means there are asynchronous operations that weren't
  stopped... Consider running Jest with --detectOpenHandles` (đã ghi nhận
  từ Step 6, chưa điều tra) vẫn xuất hiện ở Step 7. Nghi ngờ (chưa xác
  nhận): có thể cộng thêm 1 connection pool `pg` mới từ
  `database-source-client.ts` chưa được đóng đúng lúc, ngoài nghi vấn cũ
  của Step 6. Vẫn KHÔNG chặn tiến độ, nhưng nên điều tra sau khi Step 8
  xong, trước khi nộp bài.

### Step 8 — 2026-09-03

**Trạng thái: HOÀN TẤT — đã verify THẬT trên Docker thật (5/5 suite, 38/38
test).** (Lúc viết entry này, dòng trạng thái ghi "code xong, verify
OFFLINE pass — CHƯA verify Docker thật (máy này không có Docker chạy
được), chờ máy có Docker" — đã lỗi thời từ khi đó; xem entry **"Step 8 —
HOÀN TẤT, verify thật trên Docker thật"** ở cuối chuỗi entry Step 8 bên
dưới để xem bằng chứng log thật.)

**Quyết định kiến trúc — đã chốt sẵn từ đầu bài (không cần hỏi lại như Step 7):**
- Khác Step 7 (phải dừng lại dùng `AskUserQuestion` vì đề không chỉ định hạ
  tầng), lần này quyết định kiến trúc được giao sẵn: thêm service
  `supplier-portal` trong `docker-compose.yml`, mirror pattern
  `fixture-api`/`production-db`, trả về HTML thật (không phải JSON) có
  phân trang — cố ý khác Step 6 để test đúng 2 rủi ro riêng của crawling
  (pagination loop, malformed row) mà 1 REST API sạch không mô phỏng thật
  được.
- Trích nguyên văn đề bài gốc (không có trong `docs/plan-v4.md`) đã dùng
  làm ground truth: "Provide a locally hosted, paginated supplier page.
  Crawl: Delivery number, Supplier, Batch ID, Quantity, Delivery time, A
  stable source-record identifier. Prevent pagination loops and report
  malformed rows without failing the whole collection run."
- Đối chiếu `docs/plan-v4.md`/`batch-scenarios.ts`: B002 đã là scenario
  RECEIVING sẵn có ("single ACCEPTED at RECEIVING -> IN_PROGRESS", comment
  gốc trong file) — dùng lại đúng batch này cho toàn bộ dữ liệu crawl-test,
  không bịa batch/ID mới.

**Đã làm:**
- `supplier-portal/` (top-level, ngang hàng `fixture-api/`/`production-db/`/
  `backend/`/`frontend/`) — mock "Supplier Portal", plain Node `http`, zero
  dependency (mirror `fixture-api/`). `GET /deliveries?page=N` trả HTML
  thật: 1 `<table>`, mỗi delivery là 1 `<tr data-source-record-id="...">`
  (stable identifier — field riêng biệt với "delivery number", đúng 6
  field đề bài liệt kê: delivery number/supplier/batch id/quantity/delivery
  time nằm trong `<td class="...">`), `<div id="pagination"
  data-total-pages="N">` + `<a rel="next" href="...">` khi còn trang kế.
  KHÔNG auth — cố tình, vì đề mô tả đây là "a locally hosted, paginated
  supplier page" công khai, khác hẳn Application API (Step 6, x-api-key)
  và Production Database (Step 7, password) — không có test secret
  regression cho Step 8 vì không có secret nào để rò rỉ.
  - Fault injection qua query param `fault` (mirror pattern Step 6): `none`
    (mặc định, 2 trang, 3 dòng hợp lệ, batchId = B002), `malformed` (1
    trang, 3 dòng, dòng giữa có `quantity="N/A"` — sai định dạng số),
    `loop` (trang 1 → trang 2 → **quay lại trang 1** — pagination loop thật).
- `backend/src/modules/collection-runs/supplier-crawler-client.ts` (mới,
  mirror `fixture-api-client.ts`/`database-source-client.ts`):
  `checkReachable`, `discoverFeed`, `crawlDeliveries` — tự viết regex
  parser (KHÔNG thêm dependency HTML-parsing ngoài như cheerio, đúng chỉ
  dẫn "dừng lại xác nhận trước khi thêm" — không cần vì cả 2 đầu wire đều
  tự kiểm soát, format HTML cố tình đơn giản/đều đặn).
  - Pagination loop protection 2 lớp: (1) chính — `Set` các URL trang đã
    crawl, phát hiện lặp thì abort ngay; (2) phòng thủ thêm — hard cap
    `maxPages=50` (hằng số `MAX_CRAWL_PAGES` trong `collection-runs.service.ts`)
    phòng trường hợp feed luôn sinh URL MỚI (không lặp lại nhưng không bao
    giờ kết thúc).
  - Malformed row: parse từng dòng độc lập, dòng thiếu field/sai định dạng
    số/sai định dạng ngày bị gom vào `malformedRows[]` kèm lý do cụ thể,
    KHÔNG throw — các dòng hợp lệ khác trong cùng trang/lần crawl vẫn được
    giữ lại.
- `backend/src/modules/collection-runs/types.ts`: thêm `CrawlerSourceConfig`
  (`{ baseUrl, fault? }` — không có field secret nào).
- `backend/src/modules/canonicalization/types.ts` +
  `canonicalization.service.ts`: thêm field optional `payload?:
  Record<string, unknown>` vào `NewSourceRecordInput`, merge vào
  `source_records.payload` cạnh `quantity` khi có. Step 6/7 không set field
  này nên payload của 2 collector đó giữ nguyên y hệt trước (`{ quantity }`
  only) — addition thuần, không phải thay đổi hành vi. Dùng để giữ lại
  `deliveryNumber`/`supplier` (2 trong 6 field đề bài yêu cầu trích xuất
  nhưng không có cột riêng nào trong schema) trên raw record thay vì vứt
  bỏ.
- `backend/src/modules/collection-runs/collection-runs.service.ts`: thêm
  `runCrawlerCollection` (dispatch theo `source.type === 'CRAWLER'`),
  KHÔNG retry loop (đúng đề bài — chỉ Application API cần retry). Mọi
  record crawl được gán cứng `station: 'RECEIVING'` (đề bài xác định
  crawler là nguồn DUY NHẤT cho RECEIVING, không đọc station từ trang).
  Malformed row KHÔNG làm fail run — tái dùng `errorCount`/`errorMessage`
  có sẵn của `collection_runs` để ghi lại số dòng bị skip + lý do (giống
  cách Step 6 dùng `errorCount` trên run SUCCESS để ghi "số lần fail trước
  khi thành công"), không thêm cột schema mới. Pagination loop (hoặc chạm
  backstop 50 trang) → run FAILED, KHÔNG ingest bất kỳ dòng nào đã đọc
  được trước đó (xem "Quyết định phát sinh" bên dưới).
- `backend/src/modules/sources/sources.service.ts`: `verifyConnection`/
  `discoverSchema` tổng quát hoá để dispatch cả `DATABASE` (Step 7, không
  đổi hành vi) lẫn `CRAWLER` (Step 8, mới) theo `source.type`; thêm
  `resolveCrawlerConfig` (không resolve secret nào, khác
  `resolveDatabaseConfig`). `selectTable` giữ nguyên DATABASE-only — gọi
  trên CRAWLER sẽ throw `BadRequestException` rõ ràng (không có gì để
  select).
- `docker-compose.yml`: service `supplier-portal` mới (container port
  4200, host port 4300, healthcheck kiểu `fixture-api`), `backend` thêm
  `depends_on: supplier-portal: condition: service_healthy` (KHÔNG thêm
  biến môi trường cố định nào — baseUrl của mỗi CRAWLER Source được cung
  cấp trực tiếp lúc `POST /sources`, không có "1 địa chỉ cố định" cần biến
  env, giống lý do Production Database's host/port/user không cần env
  riêng ở Step 7).
- `backend/.env.example`: thêm comment ghi chú host port 4300 cho
  supplier-portal (không có biến bắt buộc nào, chỉ để tiện tra cứu khi
  chạy backend trực tiếp trên host).
- `backend/test/crawler-collector.e2e-spec.ts` (Step 8, DB thật +
  supplier-portal in-process, mirror `collection-runs.e2e-spec.ts`):
  `test.each` verify connection (portal reachable → thành công; portal
  không reachable → thất bại, `verifiedAt` không đổi); discover trả đúng
  `{ reachable: true, totalPages: 2 }`; crawl hết N trang hợp lệ → đúng 3
  `source_records` qua 2 trang; malformed row → skip 1, ingest 2, run
  SUCCESS, `errorMessage` có chi tiết; pagination loop → run FAILED, 0
  `source_records` được ingest, app vẫn `GET /health` được; B002
  end-to-end → `canonical_events['B002:RECEIVING']` ACCEPTED quantity=100,
  `getBatchStatus('B002', ...)` trả `state=IN_PROGRESS`,
  `currentStation=RECEIVING`. KHÔNG có secret regression test (không có
  secret để test).
- `scripts/verify-step8.sh` (`chmod +x`, `bash -n` sạch) — mirror
  `verify-step6.sh`: preflight rebuild+health-check cả 5 service, `npm run
  test:e2e` đầy đủ, 1 lần gọi thật `POST /collection-runs` với
  `fault=malformed` + tail log backend bắt dòng warning "skipped malformed
  row" thật. Script `verify:step8` trong `backend/package.json`. Viết
  xong, KHÔNG tự chạy được (máy này không có Docker).

**Vấn đề gặp phải:**
- **Bug tự phát hiện qua smoke test thủ công** (không phải qua `test:e2e`
  thật — máy này không chạy được `test:e2e`): `resolveNextUrl` ban đầu đưa
  thẳng giá trị regex-extract của attribute `href="..."` vào `new URL()`
  mà không unescape HTML entity trước. `supplier-portal/server.js` tự
  escape `&` thành `&amp;` khi render href có nhiều query param (ví dụ
  `?page=2&fault=loop` → `?page=2&amp;fault=loop`). Vì chuỗi `&amp;` VẪN
  chứa 1 ký tự `&` thật ở đầu, `URLSearchParams` tách nhầm thành 2 param
  `page=2` và `amp;fault=loop` (key sai `amp;fault`, không phải `fault`) —
  hệ quả: mọi request sang trang kế thừa kế đều ÂM THẦM mất giá trị
  `fault` thật, quay về default `none` của supplier-portal. Với fixture
  `loop`, bug này khiến trang 2 bị phục vụ nhầm sang bộ dữ liệu `none`
  (không loop) thay vì bộ `loop` thật — bài test pagination-loop sẽ pass
  GIẢ (không phải vì code phát hiện loop đúng, mà vì bug khiến crawler
  không bao giờ THẤY loop). Phát hiện bằng cách viết 1 script tạm
  (`smoke-crawler-tmp.ts`, `ts-node` + `--compiler-options
  {"module":"commonjs"}`, cùng pattern Step 5's seed script) gọi thẳng
  `crawlDeliveries` qua supplier-portal in-process cho cả 3 fault mode và
  in ra kết quả thật — thấy fixture `loop` không throw như kỳ vọng, truy
  ngược ra đúng nguyên nhân. Sửa bằng cách `unescapeHtml()` giá trị href
  trước khi đưa vào `new URL()`; chạy lại smoke test cả 3 mode → đúng kỳ
  vọng (none: 3 rows/2 pages; malformed: 2 rows + 1 malformed đúng lý do;
  loop: throw `SupplierCrawlerError` đúng thông báo "already crawled").
  Script tạm đã xoá sau khi xác nhận, không commit. Bài học: y hệt tinh
  thần Step 7's `let rows` — đừng chỉ tin code "trông đúng"/`tsc` sạch,
  chủ động dựng 1 kịch bản chạy thật (dù offline) để tự phản chứng trước
  khi báo cáo xong.
- Không verify được cú pháp/hành vi thật của `docker-compose.yml`'s
  service `supplier-portal` (build, healthcheck) qua Docker thật — máy
  này không có Docker. Chỉ review bằng mắt (mirror chính xác cấu trúc
  `fixture-api` đã verify thật ở Step 6) — **CHƯA verify chạy thật**, nằm
  trong Phần B.
- Không verify được `npm run test:e2e` thật (cần Postgres) —
  `crawler-collector.e2e-spec.ts` mới CHƯA từng chạy qua Jest thật lần
  nào, chỉ verify gián tiếp qua `tsc --noEmit` sạch, `eslint` sạch, và
  smoke test thủ công ở trên xác nhận đúng logic
  `supplier-crawler-client.ts` (không xác nhận được phần Nest DI/Prisma/
  canonicalization integration thật) — **CHƯA verify chạy thật**, nằm
  trong Phần B.

**Quyết định phát sinh:**
- Pagination loop (hoặc chạm backstop `maxPages`) → run kết thúc
  **FAILED**, KHÔNG ingest bất kỳ dòng nào đã crawl được trước khi phát
  hiện loop — chọn hướng này (thay vì SUCCESS với phần dữ liệu thu thập
  được) vì nhất quán với bất biến đã có ở MỌI collector khác trong repo:
  run FAILED luôn đồng nghĩa "không tin dữ liệu đã đọc, không ingest gì"
  (Step 6 fault 500-always, Step 7 lỗi kết nối DB). Một loop có nghĩa hệ
  thống không còn chắc chắn đã đọc hết/đúng toàn bộ feed — khác hẳn 1 dòng
  malformed đơn lẻ (biết chắc DÒNG NÀO sai, các dòng khác vẫn đáng tin).
- Malformed row KHÔNG cần cột schema mới — tái dùng
  `collection_runs.errorCount`/`errorMessage` có sẵn từ Step 6 (encode
  "skipped N malformed row(s): lý do..."), theo đúng tinh thần Step 6 đã
  dùng `errorCount` linh hoạt cho "có trục trặc nhưng vẫn OK" thay vì chỉ
  0/thành-công.
- `NewSourceRecordInput` được thêm field optional `payload?` (thay vì mở
  rộng `SourceRecordInput`/pipeline thuần Rule 1–5b của Step 3, giữ
  nguyên không đổi) — chỉ chạm đúng type ghi (Step 5+, dùng bởi ingestion,
  không phải pure canonicalization pipeline) để giảm rủi ro thay đổi lan
  sang các unit test Step 3/4 đã pass.
- CRAWLER không có bước "select" — khác DATABASE (Step 7, nhiều bảng để
  chọn), supplier portal chỉ có đúng 1 deliveries feed, không có gì để
  chọn giữa nhiều lựa chọn; `discoverSchema` cho CRAWLER trả `{ reachable,
  totalPages }` thay vì danh sách bảng/cột, đúng gợi ý đơn giản hoá trong
  chỉ dẫn Step 8.
- "Delivery number" và "stable source-record identifier" được thiết kế là
  2 field TÁCH BIỆT trong fixture HTML (`<td class="delivery-number">` vs
  `<tr data-source-record-id="...">`) dù giá trị nào cũng có thể dùng làm
  định danh — đúng theo cách đề bài liệt kê chúng như 2 mục riêng trong
  danh sách 6 field, không gộp làm 1 để tránh đọc sai yêu cầu.
- Toàn bộ dữ liệu crawl-test dùng batchId `B002` — không tạo batch/ID mới,
  đúng chỉ dẫn "tìm đúng scenario liên quan, đừng bịa thêm"; B002 là
  scenario RECEIVING-only sẵn có trong `batch-scenarios.ts` ("single
  ACCEPTED at RECEIVING -> IN_PROGRESS").
- KHÔNG cần migration Prisma mới cho Step 8 (không có cột/bảng nào thêm
  vào `schema.prisma`) — khác Step 6 (`errorMessage`) và Step 7
  (`verifiedAt`), nên bài học cạm bẫy #11 (`docs/HANDOFF.md`, migration
  chưa `git add`) không áp dụng ở Step 8 theo cách trực tiếp; vẫn nhắc lại
  trong Phần B để không quên nếu sau này có đổi ý thêm cột.

**Verify OFFLINE (không cần Docker/Postgres — chỉ cần Node):**
- `npx tsc --noEmit` sạch toàn repo.
- `npx eslint "{src,apps,libs,test}/**/*.ts"` sạch toàn repo (chạy lại sau
  `--fix`, đúng bài học Step 3/6).
- `npm run test`: vẫn 22/22 pass, không case nào mới (mọi test Step 8 đều
  đụng DB thật nên nằm ở `test:e2e`, chưa chạy được) — dán nguyên output:
  ```
  PASS src/app.controller.spec.ts
  PASS src/modules/canonicalization/canonicalization.pipeline.spec.ts
  PASS src/modules/production-domain/batch-state.spec.ts
  PASS src/modules/production-domain/freshness.spec.ts

  Test Suites: 4 passed, 4 total
  Tests:       22 passed, 22 total
  ```
- Smoke test thủ công KHÔNG đụng Postgres (script tạm
  `smoke-crawler-tmp.ts`, đã xoá sau khi chạy, xem "Vấn đề gặp phải"): xác
  nhận `checkReachable`/`discoverFeed`/`crawlDeliveries` đúng hành vi cho
  cả 3 fault mode qua supplier-portal in-process thật (không mock).
- `bash -n scripts/verify-step8.sh` sạch.

### Step 8 — HOÀN TẤT, verify thật trên Docker thật — 2026-09-03

`npm run test:e2e` chạy PASS thật trên máy có Docker — **5/5 suite, 38/38
test**, gồm `crawler-collector.e2e-spec.ts` (Step 8) chạy đúng cả 6 nhóm
case (verify connection, discover, crawl-N-trang-hợp-lệ, malformed-row,
pagination-loop, B002 end-to-end) trên Postgres thật + service
`supplier-portal` thật trên Docker. Step 8 coi như xong và đã verify thật,
không chỉ offline nữa.

**Đã làm (tổng hợp lại đầy đủ, không chỉ trỏ ngược về entry cũ):**
- Service `supplier-portal` — HTML thật, có phân trang, fault injection
  `none`/`malformed`/`loop`, mirror đúng pattern `fixture-api`/
  `production-db` đã dùng ở Step 6/7.
- `supplier-crawler-client.ts` — `checkReachable`/`discoverFeed`/
  `crawlDeliveries`, tự viết regex parser thay vì thêm thư viện
  HTML-parsing ngoài (cả 2 đầu wire đều tự kiểm soát, format HTML cố tình
  đơn giản/đều đặn nên không cần cheerio hay tương đương).
- Pagination-loop protection 2 lớp: (1) chính — `Set` các URL trang đã
  crawl, phát hiện lặp thì abort ngay; (2) phòng thủ thêm — hard cap
  `maxPages=50`, phòng trường hợp feed luôn sinh URL MỚI (không lặp lại
  nhưng không bao giờ kết thúc).
- Malformed row: parse từng dòng độc lập, dòng lỗi bị skip + ghi lại vào
  `errorCount`/`errorMessage` của `collection_runs` thay vì fail toàn bộ
  run — các dòng hợp lệ khác trong cùng lần crawl vẫn được ingest bình
  thường.
- Mọi record crawl được gán cứng `station: RECEIVING` — đúng bảng mapping
  đề bài gốc (crawler là nguồn DUY NHẤT cho RECEIVING).
- `SourcesService.verifyConnection`/`discoverSchema` tổng quát hoá để
  dispatch cả `DATABASE` (Step 7) lẫn `CRAWLER` (Step 8) theo
  `source.type`; CRAWLER không có bước "select" (chỉ 1 deliveries feed,
  không có gì để chọn).

**Vấn đề gặp phải (trình tự thật):**
1. Đề bài gốc dùng chữ "page" (không phải "API") một cách cố ý — quyết
   định crawl HTML thật thay vì trả JSON sạch, để test đúng 2 rủi ro đặc
   thù của crawling (pagination loop, malformed row) mà 1 REST API sạch
   không thể mô phỏng chân thực (chi tiết đầy đủ đã ghi trong entry Step
   8 gốc bên trên).
2. Bug thật tự bắt được qua smoke test thủ công (không phải qua
   `test:e2e` — lúc đó máy code chưa có Docker): `resolveNextUrl` không
   unescape HTML entity (`&amp;`) trước khi parse URL, làm hỏng query
   param `fault` trên mọi link "next" — hệ quả cụ thể: fixture `loop` sẽ
   bị phục vụ nhầm sang bộ dữ liệu `none` (không loop), khiến test
   pagination-loop **pass giả** (không phải vì code phát hiện loop đúng,
   mà vì bug khiến crawler không bao giờ thấy loop). Đã sửa bằng
   `unescapeHtml()` trước khi đưa href vào `new URL()`, xác nhận lại bằng
   smoke test tạm cho cả 3 fault mode (đã xoá script sau khi dùng).

**Bằng chứng log thật (`npm run test:e2e` + 1 lần gọi thật `fault=malformed`, dán nguyên văn):**
```
PASS test/crawler-collector.e2e-spec.ts
PASS test/database-collector.e2e-spec.ts
PASS test/batch-lifecycle.e2e-spec.ts
PASS test/collection-runs.e2e-spec.ts
PASS test/app.e2e-spec.ts

Test Suites: 5 passed, 5 total
Tests:       38 passed, 38 total

celesnity-backend | WARN [CollectionRunsService] Collection run
7eca8b56-... (source 323ba921-...) skipped malformed row on page 1: row
CRAWL-B002-102: invalid quantity "N/A"
POST /collection-runs response: {"status":"SUCCESS","recordsRead":2,
"errorCount":1,"errorMessage":"skipped 1 malformed row(s): page 1 (row
CRAWL-B002-102: invalid quantity \"N/A\")",...}
```
Đọc đúng: dòng `CRAWL-B002-102` có `quantity="N/A"` (sai định dạng số) bị
skip, ghi lại đúng lý do trong `errorMessage`; 2 dòng hợp lệ còn lại vẫn
được ingest (`recordsRead: 2`); run kết thúc `SUCCESS` — đúng yêu cầu đề
bài "report malformed rows without failing the whole collection run".

**Quyết định phát sinh (xác nhận lại quyết định đã ghi ở entry gốc, giải
thích rõ lý do cho reviewer):**
- Khi phát hiện pagination loop, collection run kết thúc **FAILED** và
  **KHÔNG ingest** bất kỳ dữ liệu nào đã crawl được trong lần chạy đó —
  khác hẳn cách xử lý malformed row (vẫn ingest các dòng hợp lệ còn lại).
  Lý do: pagination loop là dấu hiệu bất thường ở **tầng cấu trúc/kết
  nối** của cả lần crawl (feed đang lặp lại chính nó, không rõ đã đọc hết
  hay chưa, không rõ có đang đọc trùng dữ liệu hay không), khác hẳn 1
  malformed row — vốn là lỗi **cục bộ, biết chính xác dòng nào sai**, các
  dòng còn lại trong cùng lần crawl vẫn hoàn toàn đáng tin. Vì không có
  cách nào biết chắc dữ liệu đã crawl được TRƯỚC khi phát hiện loop có
  đầy đủ/không trùng lặp hay không, lựa chọn an toàn hơn là không ingest
  gì cả (nhất quán với bất biến run FAILED = "không ingest" đã áp dụng
  cho mọi collector khác trong repo — Step 6 fault 500-always, Step 7 lỗi
  kết nối DB) thay vì ingest 1 phần dữ liệu không rõ chất lượng. Đây là
  lựa chọn thiết kế tự đặt ra — đề bài chỉ yêu cầu "prevent pagination
  loops", không quy định cụ thể collection run phải kết thúc SUCCESS hay
  FAILED khi loop bị phát hiện.

**Việc chưa xong, chưa chặn tiến độ, ghi lại để không quên:**
- Cảnh báo `Jest did not exit one second after the test run has completed.
  This usually means there are asynchronous operations that weren't
  stopped... Consider running Jest with --detectOpenHandles` (đã ghi nhận
  từ Step 6, vẫn xuất hiện ở Step 7 và giờ là Step 8) — vẫn CHƯA điều tra.
  Không chặn tiến độ, nhưng nên dành thời gian điều tra trước khi nộp bài
  nếu còn dư (cả 3 step cộng dồn khả năng có nhiều hơn 1 connection
  pool/HTTP agent chưa đóng đúng lúc, không chỉ riêng 1 nguồn).

### Step 9 — 2026-09-03

**Trạng thái: HOÀN TẤT, verify THẬT trên Docker thật (6/6 suite, 52/52
test) — xem "Verify THẬT trên Docker thật" bên dưới cho bằng chứng log
thật đầy đủ, gồm cả 3 lệnh gọi HTTP thật cho action BLOCK/RESUME và cho
validation quan trọng nhất của Step 9 (resume trên batch chưa từng bị
block → 400).**

**Kiểm tra trước khi code (theo yêu cầu của prompt Step 9) — kết quả:**
1. Bảng `management_events` **đã tồn tại từ Step 2** (`schema.prisma`,
   dòng ~202) — đúng như dự đoán, **KHÔNG cần migration mới** cho Step 9,
   chỉ cần service/controller ghi thật vào bảng có sẵn.
2. Seeded organization: **đã có sẵn** — `prisma/seed.ts` (Step 5) đã tự
   định nghĩa `SEED_ORGANIZATION_ID = 'org-seed'` làm hằng số cục bộ,
   nhưng CHƯA được chia sẻ ra ngoài file đó. Đã refactor: chuyển thành
   `SEED_ORGANIZATION_ID` export từ
   `backend/src/modules/management-events/constants.ts`, `prisma/seed.ts`
   import lại hằng số này thay vì tự khai báo riêng — đúng chỉ dẫn "đừng
   hardcode giá trị rải rác nhiều nơi". Seeded actor: **KHÔNG có** hằng số
   dùng chung nào (chỉ có giá trị `'ops-1'` rải rác trong
   `batch-scenarios.ts`'s management events, không phải constant chính
   thức) — xem "Quyết định phát sinh" bên dưới về lý do KHÔNG thêm 1 hằng
   số actor seeded tương tự.
3. Logic tính `acknowledged` (Rule 5b): **đã tồn tại đầy đủ, đã DB-wired
   từ Step 5** — không chỉ là pure function chưa nối. Phát hiện ngay khi
   đọc lại `ProductionDomainService.getBatchStatus`
   (`production-domain.service.ts`): đã tự query `management_events` thật
   qua Prisma và derive `acknowledged` bằng cách so `ACK_EXCEPTION`
   timestamp với `canonical_event.updatedAt` (đúng nguyên văn cách diễn
   giải "cùng station" đã ghi trong `docs/HANDOFF.md` mục 6). Tương tự,
   `resolveIsBlocked`/`resolveBatchState` (Rule 7, `batch-state.ts`, Step
   4) cũng đã được `getBatchStatus` gọi thật với `management_events` đọc
   từ DB — batch state BLOCKED đã hoạt động đúng từ Step 5, chỉ là chưa
   từng có cách nào GHI 1 row `BLOCK` thật qua HTTP (trước Step 9, chỉ
   test/seed tự insert thẳng qua Prisma). **Kết luận: Step 9 chỉ cần thêm
   phần GHI (4 endpoint POST) — phần ĐỌC/tính toán state không cần sửa gì
   cả.**

**Đã làm:**
- `backend/src/modules/management-events/constants.ts` (mới) —
  `SEED_ORGANIZATION_ID = 'org-seed'`, dùng chung giữa `prisma/seed.ts` và
  `ManagementEventsService` (xem mục kiểm tra #2 ở trên).
- `backend/src/modules/management-events/types.ts` (mới) —
  `ManagementActionDto` (`{ batchId, actor, note? }`, dùng cho
  block/resume/ack-exception) và `AddNoteDto` (`{ batchId, actor, note }`,
  `note` bắt buộc). Không dùng `class-validator` — nhất quán với quyết
  định đã ghi ở Step 6 (chưa module nào trong codebase dùng validation
  pipe).
- `ManagementEventsService` (viết lại từ rỗng) — 4 method:
  - `block`: không có precondition, cho phép block lại (manager re-block
    vì lý do khác).
  - `resume`: reuse thẳng `resolveIsBlocked` (Step 4, `batch-state.ts`,
    **không đổi 1 dòng**) trên lịch sử `management_events` thật của batch
    — từ chối (400) nếu batch hiện KHÔNG bị block.
  - `ackException`: từ chối (400) nếu batch không có canonical event nào
    đang `CONFLICT`.
  - `addNote`: từ chối (400) nếu `note` rỗng/thiếu.
  - Tất cả 4 method chỉ gọi `prisma.managementEvent.create()` — không có
    `.update()`/`.delete()` nào trên bảng này ở bất kỳ đâu trong service
    (append-only tuyệt đối, đúng "Do not overwrite collected source
    history"). `timestamp` luôn là `new Date()` lấy ở server, KHÔNG BAO
    GIỜ nhận từ request body — một audit log append-only sẽ mất ý nghĩa
    nếu caller có thể tự ghi lùi ngày.
  - `organizationId` luôn gán cứng `SEED_ORGANIZATION_ID`; `actor` bắt
    buộc lấy từ request body (không seed cứng — xem "Quyết định phát
    sinh").
- `ManagementEventsController` (viết lại từ rỗng) — `POST
  /management-events/block|resume|ack-exception|note`, chỉ có handler
  `POST` (đúng route shape tự thiết kế, xem "Assessment Assumptions" ở
  trên).
- `backend/prisma/seed.ts`: import `SEED_ORGANIZATION_ID` từ constant
  dùng chung thay vì tự khai báo lại (refactor thuần, không đổi hành vi
  seed).
- `backend/test/management-events.e2e-spec.ts` (Step 9, DB thật, KHÔNG
  cần fixture service mới — bảng đã có sẵn từ Step 2): nhóm "4 action ghi
  đúng row" (`test.each` qua action, chung 1 `beforeEach` tạo cả 4 event
  thật qua HTTP); B006 end-to-end (ACK_EXCEPTION không đổi
  `canonical_event.status`, chỉ đổi `acknowledged`); `ack-exception` bị từ
  chối khi không có CONFLICT; BLOCK giữ state BLOCKED dù có event ACCEPTED
  upstream (RECEIVING); `resume` bị từ chối khi chưa từng bị block;
  `resume` sau `block` → state đúng Rule 7 (`test.each` 2 nhánh: có
  event → IN_PROGRESS, không có event → PLANNED); `note` bị từ chối khi
  rỗng; append-only (`test.each` PUT/PATCH/DELETE → 404, route không tồn
  tại).
- `scripts/verify-step9.sh` (`chmod +x`, `bash -n` sạch) — mirror
  `verify-step6.sh`/`verify-step8.sh`: preflight rebuild+health-check cả 5
  service, `npm run test:e2e` đầy đủ, 3 lần gọi thật (`POST
  /management-events/block` → `resume` trên 1 batchId MỚI hoàn toàn —
  không cần seed/đăng ký trước vì `management_events` không có FK tới
  `batches`; + 1 lần `resume` trên batchId chưa từng bị block để bắt bằng
  chứng 400 thật). Script `verify:step9` trong `backend/package.json`.
  Viết xong, KHÔNG tự chạy được (máy này không có Docker).

**Vấn đề gặp phải:**
- Không có bug code tự phát hiện nào đáng ghi lại ở Step 9 (khác Step 7's
  `let rows`/Step 8's `resolveNextUrl` — cả 2 bug trước đều nằm ở logic
  parse/type-inference phức tạp; Step 9 phần lớn là CRUD append-only đơn
  giản, không có phần nào tương tự). `tsc --noEmit` sạch ngay từ lần chạy
  đầu, bao gồm cả việc gán `ManagementAction` (Prisma enum) trực tiếp vào
  tham số kiểu `ManagementAction` của `prisma.managementEvent.create()`
  không cần ép kiểu — xác nhận đúng suy đoán ban đầu (Prisma sinh enum
  dạng string-literal union, cùng cách `production-domain.service.ts` đã
  làm từ Step 5 khi gán `row.action` ngược lại vào
  `ManagementEventInput.action`).
- KHÔNG có route `GET /batches/:batchId/status` (hoặc tương đương) nào để
  test qua HTTP thật — `ProductionDomainController` vẫn rỗng từ Step 1
  (chưa ai wire route cho `ProductionDomainService.getBatchStatus`, kể cả
  ở Step 5). Việc thêm route đó KHÔNG nằm trong phạm vi 4 việc liệt kê ở
  Step 9 (chỉ "ManagementEventsService với 4 action"), nên test đọc lại
  state qua injection trực tiếp `productionDomainService.getBatchStatus()`
  trong Nest testing module — đúng pattern đã dùng ở B006 test của
  `collection-runs.e2e-spec.ts` (Step 6) — không phải qua HTTP. Route GET
  batch status để UI dùng thật sẽ cần khi làm UI (bước sau Step 9), chưa
  làm ở đây để không lấn phạm vi.

**Quyết định phát sinh:**
- Route shape `POST /management-events/block|resume|ack-exception|note`
  (batchId nằm trong body, không phải path param) — xem lý do đầy đủ ở
  mục "Assessment Assumptions" phía trên: không có REST contract nào cho
  phần này trong `docs/plan-v4.md` hay đề bài gốc, đây là thiết kế tự
  đặt ra.
- `actor` bắt buộc lấy từ request body của caller, KHÔNG dùng 1 hằng số
  seeded cố định giống `organizationId` — dù đề bài cho phép "seeded...
  actor" như 1 lựa chọn. Lý do: không giống "tổ chức nào" (chỉ có đúng 1
  tổ chức trong toàn app, không có gì để chọn), "actor nào đang thao tác"
  là thông tin thật sự khác nhau giữa các lần gọi (2 manager khác nhau
  block/resume/ack cùng 1 batch) — cố định cứng giá trị này sẽ làm audit
  log mất hết ý nghĩa phân biệt "ai đã làm gì", trong khi hệ thống không
  có auth để tự suy ra danh tính actor theo cách nào khác ngoài để caller
  tự khai báo.
- `resume` từ chối (400) khi batch hiện KHÔNG bị block, tái dùng thẳng
  `resolveIsBlocked` (Step 4, không sửa) để kiểm tra — không bắt buộc bởi
  Rule 7 (state vẫn tính đúng dù có 1 event RESUME "ma" không đi kèm
  BLOCK nào, vì `resolveIsBlocked` tự nhiên bỏ qua nó), nhưng 1 lệnh
  resume trên batch chưa từng bị block gần như chắc chắn là bug UI/double-
  click — báo lỗi rõ ràng ngay lúc đó tốt hơn là âm thầm ghi 1 event vô
  nghĩa vào log vĩnh viễn không xoá được.
- `ackException` từ chối (400) khi batch không có canonical event nào
  đang `CONFLICT` — tương tự lý do trên (chặn hành động vô nghĩa ngay từ
  đầu). KHÔNG kiểm tra thêm liệu CONFLICT đó đã được acknowledge hay chưa
  — ack lại 1 CONFLICT đã acknowledge là vô hại và hợp lệ (ví dụ CONFLICT
  tái diễn ở lần thu thập sau), chỉ thêm 1 dòng audit mới, đúng tinh thần
  append-only.
- KHÔNG kiểm tra `batchId` có tồn tại trong bảng `batches` hay chưa trước
  khi ghi management event — nhất quán với quyết định gốc từ Step 2:
  `source_records`/`canonical_events`/`management_events.batch_id` cố
  tình KHÔNG có FK tới `batches` (comment sẵn trong `schema.prisma`), vì
  raw/audit layer không phụ thuộc business layer. Hệ quả trực tiếp: có
  thể ghi management event cho 1 `batchId` "chưa tồn tại" theo nghĩa
  nghiệp vụ — chấp nhận được, cùng triết lý với toàn bộ phần còn lại của
  hệ thống.
- `timestamp` luôn là `new Date()` phía server, không bao giờ nhận từ
  request body dù `ManagementActionDto` có thể dễ dàng thêm field này —
  cố tình KHÔNG thêm, để không ai vô tình cho phép client tự ghi timestamp
  giả vào 1 audit log lẽ ra phải đáng tin tuyệt đối.

**Verify OFFLINE (không cần Docker/Postgres — chỉ cần Node):**
- `npx tsc --noEmit` sạch toàn repo.
- `npx eslint "{src,apps,libs,test}/**/*.ts"` sạch toàn repo (chạy lại sau
  `--fix`, đúng bài học Step 3/6).
- `npm run test`: vẫn 22/22 pass, không case nào mới (mọi test Step 9 đều
  đụng DB thật nên nằm ở `test:e2e`, chưa chạy được) — dán nguyên output:
  ```
  PASS src/modules/canonicalization/canonicalization.pipeline.spec.ts
  PASS src/modules/production-domain/freshness.spec.ts
  PASS src/modules/production-domain/batch-state.spec.ts
  PASS src/app.controller.spec.ts

  Test Suites: 4 passed, 4 total
  Tests:       22 passed, 22 total
  ```
- `bash -n scripts/verify-step9.sh` sạch.

**Verify THẬT trên Docker thật (`npm run test:e2e` + 3 lệnh gọi HTTP thật,
dán nguyên văn từ log, không tóm tắt):**
```
PASS test/management-events.e2e-spec.ts
PASS test/crawler-collector.e2e-spec.ts
PASS test/batch-lifecycle.e2e-spec.ts
PASS test/collection-runs.e2e-spec.ts
PASS test/database-collector.e2e-spec.ts
PASS test/app.e2e-spec.ts

Test Suites: 6 passed, 6 total
Tests:       52 passed, 52 total

POST /management-events/block response: {"id":"9c5595de-...","action":
"BLOCK","actor":"verify-step9-script","timestamp":"2026-09-04T03:40:59.775Z",...}
POST /management-events/resume response (batch was just blocked above):
{"id":"0d750de2-...","action":"RESUME",...} — 201 Created
POST /management-events/resume on a NEVER-blocked batch -> HTTP 400
(expected 400), body: {"message":"Batch ... is not currently blocked —
nothing to resume","error":"Bad Request","statusCode":400}
```
Đọc đúng: 6/6 e2e suite pass, 52/52 test (52 = 22 unit đã pass từ trước +
test mới của `management-events.e2e-spec.ts` cộng vào tổng e2e); `BLOCK`
ghi thật 1 row với `actor`/`timestamp` thật; `RESUME` ngay sau đó trên
đúng batch vừa bị block → `201 Created`; và validation quan trọng nhất
của Step 9 — gọi `resume` trên 1 batch **chưa từng** bị block — bị từ
chối đúng `400 Bad Request` với message rõ ràng, xác nhận `resolveIsBlocked`
(Step 4) hoạt động đúng khi được gọi thật qua HTTP, không chỉ qua Jest.

Ghi chú: cảnh báo `Jest did not exit one second after the test run has
completed... Consider running Jest with --detectOpenHandles` vẫn xuất
hiện (đã ghi nhận từ Step 6, chưa điều tra) — không chặn tiến độ.

### Step 10 — 2026-09-04

**Trạng thái: HOÀN TẤT, verify THẬT trên Docker thật (7/7 suite, 59/59
test) — xem entry "Step 10 — bổ sung `lastEventAt` + provenance links sau
khi phát hiện qua gọi thật" bên dưới (đã cập nhật với bằng chứng
curl/`test:e2e` thật, gồm cả phần bổ sung sau). (Lúc viết entry này, dòng
trạng thái ghi "code xong, verify OFFLINE pass — CHƯA verify Docker/
`test:e2e` thật" — đã lỗi thời từ khi đó.) Step 10 CHỈ làm backend (read
API cho UI) — không có code frontend.**

**Audit trước khi code (grep toàn bộ `*.controller.ts`) — kết quả:**

Đã có sẵn từ Step 1–9:
- `POST /sources`, `GET /sources/:id`, `POST /sources/:id/verify`, `GET
  /sources/:id/discover`, `POST /sources/:id/select` (`SourcesController`).
- `POST /collection-runs`, `GET /collection-runs/:id`
  (`CollectionRunsController`).
- `POST /management-events/block|resume|ack-exception|note`
  (`ManagementEventsController`).
- `GET /health` (`HealthModule`, Step 1).
- `CanonicalizationController` (`@Controller('canonicalization')`) và
  `ProductionDomainController` (`@Controller('production-domain')`) **tồn
  tại nhưng hoàn toàn RỖNG** — 0 route đăng ký ở cả hai, nguyên trạng từ
  Step 1.

Còn thiếu (đối chiếu danh sách UI cần trong prompt Step 10) — KHÔNG có
route nào tương đương đã tồn tại cho: list toàn bộ Source (`GET /sources`
chỉ có `:id`), lịch sử collection run theo source kèm duration, preview
canonical event kèm provenance, rollup theo Production Line, và
`STALE_THRESHOLD_MINUTES` configurable (code cũ hardcode default 15 phút
ngay trong `ProductionDomainService`, không đọc từ env ở đâu cả — xác nhận
qua grep `STALE_THRESHOLD`).

**Đã làm — endpoint mới + shape response (tài liệu tham chiếu cho Step
11–12, frontend):**

1. `GET /sources` (`SourcesController`/`SourcesService.findAll`, mới) —
   list toàn bộ Source, sanitize giống hệt `GET /sources/:id` (không lộ
   secret):
   ```json
   [{
     "id": "uuid", "name": "string", "type": "API|DATABASE|CRAWLER|MQTT",
     "config": { "...sanitized, secret bị [REDACTED]" },
     "verifiedAt": "ISO date | null", "createdAt": "ISO date", "updatedAt": "ISO date"
   }]
   ```

2. `GET /collection-runs?sourceId=` (`CollectionRunsController`, mới —
   `sourceId` optional, bỏ trống trả toàn bộ) — lịch sử collection run,
   mới nhất trước (`startedAt desc`), thêm `durationMs` (không có cột
   sẵn, tính từ `finishedAt - startedAt`, `null` khi còn RUNNING):
   ```json
   [{
     "id": "uuid", "sourceId": "uuid", "status": "RUNNING|SUCCESS|FAILED",
     "startedAt": "ISO date", "finishedAt": "ISO date | null",
     "durationMs": "number | null", "recordsRead": "number",
     "errorCount": "number", "errorMessage": "string | null"
   }]
   ```
   Không có cột nào secret-shaped trên `collection_runs` (giống lý do
   comment sẵn ở `findOne`) nên không cần sanitize thêm.

3. `GET /canonical-events?batchId=&sourceId=&collectionRunId=`
   (repurpose `CanonicalizationController`, trước đó hoàn toàn rỗng — đổi
   route từ `/canonicalization` sang `/canonical-events`, an toàn vì chưa
   ai/test nào từng gọi route cũ) — preview "normalized record" (=
   `canonical_events`, kết quả Rule 2/5) kèm đầy đủ provenance (nguồn nào,
   collection run nào tạo ra từng source record đã góp vào event đó):
   ```json
   [{
     "id": "uuid", "batchId": "B006", "station": "DISPATCH", "quantity": 480,
     "eventTime": "ISO date", "status": "ACCEPTED|CONFLICT",
     "canonicalKey": "B006:DISPATCH", "updatedAt": "ISO date",
     "sources": [{
       "relationship": "PRIMARY|DUPLICATE|SUPERSEDED|CONFLICT",
       "sourceRecordPk": "uuid", "sourceRecordId": "string (business id)",
       "sourceId": "uuid", "sourceName": "string", "sourceType": "API|DATABASE|CRAWLER|MQTT",
       "collectionRunId": "uuid", "eventTime": "ISO date", "receivedAt": "ISO date"
     }]
   }]
   ```

4. `GET /production-lines` (controller mới `ProductionLinesController`,
   mount trong `ProductionDomainModule` cạnh `ProductionDomainController`
   đã rỗng có sẵn) — rollup theo line, tái sử dụng NGUYÊN
   `ProductionDomainService.getBatchStatus` (Step 4/5, không sửa 1 dòng)
   cho từng batch — route này chỉ tổng hợp/group, không có logic domain
   mới nào:
   ```json
   [{
     "lineId": "LINE-1",
     "stations": [
       { "station": "RECEIVING", "wip": 1, "batchIds": ["B002"] },
       { "station": "SORTING", "wip": 3, "batchIds": ["B005B", "B007", "B007-resume"] },
       "...đủ 6 trạm theo STATION_ORDER..."
     ],
     "batches": [{
       "batchId": "B002", "workOrderId": "WO-B002",
       "state": "PLANNED|IN_PROGRESS|BLOCKED|COMPLETED",
       "currentStation": "RECEIVING|SORTING|WASHING|DRYING|FOLDING|DISPATCH|null",
       "completedQuantity": "number | null",
       "missingStations": ["SORTING", "..."],
       "freshnessStatus": "NO_DATA|OK|STALE", "freshnessMinutes": "number | null",
       "qualityIndicators": [{ "code": "string", "acknowledged": "boolean" }],
       "lastEventAt": "ISO date | null",
       "contributingSourceRecordIds": ["uuid", "..."],
       "contributingCollectionRunIds": ["uuid", "..."]
     }]
   }]
   ```
   `wip` (per station) = số batch có `currentStation` = trạm đó VÀ
   `state !== 'COMPLETED'` — dùng đúng field `state`/`currentStation` đã
   có sẵn từ Rule 6/7, không tự suy diễn định nghĩa WIP mới.
   `lineId` là tập giá trị duy nhất của `WorkOrder.lineId` — cột này
   KHÔNG có quan hệ Prisma thật tới bảng `Line`/`lines` (xem
   `schema.prisma`: `lineId String @map("line_id")`, không `@relation`),
   nên không liệt kê từ bảng `lines` (hiện chưa ai insert dữ liệu vào đó
   ở bất kỳ step nào).
   - `lastEventAt` (**thêm sau, xem "Bổ sung sau khi phát hiện qua gọi
     thật" bên dưới**) — timestamp `eventTime` THẬT của canonical_event
     đang nằm ở `currentStation` (tra bằng `canonicalKey` =
     `${batchId}:${currentStation}`, unique). Khác với `freshnessMinutes`
     (Step 4's `calculateFreshness`, KHÔNG sửa — lấy `eventTime` ACCEPTED
     mới nhất trên TOÀN BỘ trạm của batch, có thể là 1 trạm khác
     `currentStation`, xem case B004 trong `batch-state.ts`'s comment):
     `lastEventAt` trả lời "cập nhật lúc nào" (mốc tuyệt đối tại đúng
     trạm hiện tại), `freshnessMinutes`/`freshnessStatus` trả lời "cũ tới
     mức nào" (dựa trên định nghĩa freshness đã có sẵn, không đổi). `null`
     khi `currentStation` là `null` (batch PLANNED, chưa có event nào).
   - `contributingSourceRecordIds`/`contributingCollectionRunIds` (**thêm
     sau, xem bên dưới**) — "Links to the contributing source records and
     collection run" theo đúng câu chữ đề bài. Toàn bộ `source_records.id`
     (qua `canonical_event_sources`, MỌI trạm của batch chứ không chỉ
     `currentStation`) đã góp phần tạo nên bất kỳ canonical_event nào của
     batch này, và `collection_runs.id` suy ra từ
     `source_records.collectionRunId` tương ứng (dedupe). `batchId` vẫn
     dùng được làm query param cho `GET /canonical-events?batchId=<id>` ở
     mục 3 để xem chi tiết provenance, nhưng 2 field này cho UI danh sách
     ID sẵn luôn mà không cần gọi thêm request.

5. `STALE_THRESHOLD_MINUTES` (env var mới, optional, default 15) — đọc
   qua `ConfigService` ngay trong `ProductionLinesController`, truyền
   tường minh vào `getBatchStatus(batchId, now, staleThresholdMinutes)`
   cho mỗi batch. KHÔNG sửa default cứng 15 phút sẵn có trong
   `ProductionDomainService` (`DEFAULT_STALE_THRESHOLD_MINUTES`, dùng khi
   gọi method trực tiếp không qua HTTP, ví dụ trong test) — chỉ thêm 1
   lớp đọc-từ-env ở tầng controller, đúng yêu cầu "must be configurable".
   Thêm vào `backend/.env.example`, root `.env.example`, và
   `docker-compose.yml`'s `backend.environment`.

**Vấn đề gặp phải:**
- Gọi `npx eslint "{src,apps,libs,test}/**/*.ts"` trực tiếp qua Bash tool
  ở máy này báo lỗi "No files matching the pattern" (glob brace-expansion
  không match) — nhưng `npm run lint` (chạy đúng cùng 1 lệnh, qua npm
  script) chạy sạch, không lỗi nào. Chưa rõ nguyên nhân khác biệt giữa 2
  cách gọi (nghi ngờ cách Bash tool ở môi trường này tokenize `{...}`
  khác lúc npm tự spawn shell) — không ảnh hưởng gì vì `npm run lint` mới
  là lệnh thật cần chạy (đúng script đã định nghĩa trong
  `package.json`), dùng nó thay vì gọi `npx` trực tiếp cho các step sau.
- `npm run test:e2e` **không chạy được ở máy này** — không có Docker,
  đúng như lưu ý môi trường đầu bài. Đã CHỦ ĐỘNG thử chạy để xác nhận lỗi
  không phải do code mới: **cả 7 suite** (6 suite cũ đã pass thật ở Step
  6–9 trên Docker + `read-api.e2e-spec.ts` mới của Step 10) fail với
  ĐÚNG 1 lý do duy nhất, giống hệt nhau:
  ```
  PrismaClientInitializationError: Can't reach database server at `localhost:5433`
  Please make sure your database server is running at `localhost:5433`.
  ```
  Không có lỗi biên dịch/type/import nào ở bất kỳ suite nào, kể cả
  `read-api.e2e-spec.ts` — xác nhận code Step 10 không có lỗi cấu trúc,
  chỉ đơn thuần CHƯA verify được hành vi thật vì thiếu Postgres. Đúng
  theo yêu cầu đầu bài: ghi rõ "chưa verify — cần máy có Docker" thay vì
  suy đoán kết quả.

**Quyết định phát sinh:**
- Route `/canonical-events` (không phải `/source-records` như gợi ý
  trong prompt) — "normalized record" đề bài nhắc tới chính là
  `canonical_events` (kết quả Rule 2/5 sau khi resolve), không phải
  `source_records` thô; route đặt tên đúng resource này, khớp câu
  "hoặc endpoint tương đương" trong prompt.
- `GET /production-lines` trả TẤT CẢ line trong 1 lần gọi (không chọn
  phương án `GET /lines/:id/status` cho từng line riêng đề bài gợi ý) —
  UI "Production Lines view" nhiều khả năng cần liệt kê toàn bộ line cùng
  lúc khi mở màn hình; 1 endpoint duy nhất đơn giản hơn cho frontend so
  với việc phải biết trước danh sách lineId để gọi N lần.
- `GET /production-lines` dùng `new Date()` thật tại thời điểm gọi (không
  nhận tham số `now` qua query) — khác `getBatchStatus` (Step 4) vốn nhận
  `now` tường minh để test được xác định; đây là 1 dashboard sống, luôn
  cần "freshness tính tới hiện tại", không phải 1 lần gọi cố định. Hệ quả
  trực tiếp cho test: test Step 10 của endpoint này KHÔNG assert cứng
  `freshnessStatus` theo timeline `T0` cố định của `batch-scenarios.ts`
  (T0 = năm 2026-01-01, xa thời điểm chạy test thật bất kỳ lúc nào) — chỉ
  assert `state`/`currentStation`/WIP per-station (không phụ thuộc "now")
  bằng fixture B001–B008 có sẵn; freshness/`STALE_THRESHOLD_MINUTES` được
  test riêng bằng 1 batch có `eventTime` tính tương đối theo `Date.now()`
  thật lúc test chạy, không dùng `T0`.
- KHÔNG sửa `ProductionDomainService`/`batch-state.ts`/`freshness.ts`/
  `canonicalization.service.ts` — mọi endpoint mới ở Step 10 chỉ gọi lại
  service/hàm đã có (Step 3–5), đúng yêu cầu "chỉ tổng hợp/serialize để
  expose qua API, KHÔNG viết lại logic domain".

**Test bắt buộc — `backend/test/read-api.e2e-spec.ts` (mới, DB thật,
CHƯA chạy được — xem "Vấn đề gặp phải"):** happy-path cho cả 4 endpoint
mới, dùng lại đúng fixture B001–B008 (`buildBatchScenarios`) — không bịa
scenario mới:
- `GET /sources` — tạo 1 source API + 1 source DATABASE (cố tình đưa
  `password` literal vào config để xác nhận `sanitizeSourceConfig` vẫn
  redact đúng qua route list mới, không chỉ qua `:id`), assert đủ 2 source
  trả về, `passwordEnvVar` hiển thị nhưng `password` bị `[REDACTED]`.
- `GET /collection-runs?sourceId=` — 1 run SUCCESS đã `finishedAt` (assert
  `durationMs` = 5000) + 1 run RUNNING chưa `finishedAt` (assert
  `durationMs: null`) trên cùng source, + 1 run của source KHÁC (assert bị
  lọc ra, không xuất hiện), assert thứ tự mới nhất trước.
- `GET /canonical-events?batchId=B006` — ingest fixture B006 thật
  (DISPATCH CONFLICT, 2 nguồn khác tier... cùng tier — DATABASE+API cùng
  Tier 1), assert `status: CONFLICT`, đủ 2 `sources[]` cùng
  `relationship: CONFLICT` (đúng Rule 5.4), tên nguồn đúng
  `Application API`/`Production Database`; + 1 assertion lọc theo
  `sourceId` xác nhận đúng batch B006 vẫn xuất hiện.
- `GET /production-lines` — ingest đủ 10 scenario B001–B008 (đều
  `lineId: 'LINE-1'`), assert 1 line duy nhất, `batches.length === 10`,
  WIP per-station đúng theo `state`/`currentStation` đã biết trước từ
  `batch-lifecycle.e2e-spec.ts`'s `scenarioExpectations` (RECEIVING: 1
  [B002]; SORTING: 3 [B005B, B007, B007-resume]; WASHING: 3 [B003, B004,
  B005A]; DRYING/FOLDING: 0; DISPATCH: 1 [B006] — **B008 KHÔNG tính** dù
  `currentStation=DISPATCH` vì `state=COMPLETED`).
- `STALE_THRESHOLD_MINUTES` — 1 test riêng (describe block riêng, set
  `process.env.STALE_THRESHOLD_MINUTES='1'` TRƯỚC khi compile
  `TestingModule`, đúng pattern `collection-runs.e2e-spec.ts` đã dùng cho
  `FIXTURE_API_KEY`): 1 batch có `eventTime` = 2 phút trước lúc test
  chạy, assert `freshnessStatus: STALE` dưới threshold 1 phút (mặc định
  15 phút sẽ ra `OK`) — chứng minh giá trị env thật sự được đọc, không
  chỉ code có tồn tại tham số. `afterAll` restore lại
  `process.env.STALE_THRESHOLD_MINUTES` về giá trị cũ — `jest-e2e.json`
  ghim `maxWorkers: 1` nên các file e2e chạy cùng 1 process, không restore
  sẽ rò rỉ sang suite chạy sau (đúng bài học đã ghi ở Step 6's secret-key
  leak).

**Verify OFFLINE (không cần Docker/Postgres — chỉ cần Node):**
- `npx tsc --noEmit` sạch toàn repo (không output, exit 0).
- `npm run lint` (`eslint --fix`) sạch toàn repo, không output, exit 0.
- `npm run test`: vẫn 22/22 pass, không case nào mới (mọi test Step 10 đều
  đụng DB thật nên nằm ở `test:e2e`) — dán nguyên output:
  ```
  PASS src/modules/production-domain/freshness.spec.ts
  PASS src/modules/canonicalization/canonicalization.pipeline.spec.ts
  PASS src/modules/production-domain/batch-state.spec.ts
  PASS src/app.controller.spec.ts

  Test Suites: 4 passed, 4 total
  Tests:       22 passed, 22 total
  ```
- `npm run test:e2e` — **chưa verify, cần máy có Docker.** Đã thử chạy
  (xem "Vấn đề gặp phải" ở trên cho log đầy đủ): 7/7 suite fail cùng 1 lý
  do `Can't reach database server at localhost:5433`, không có lỗi
  code/biên dịch nào.

### Step 10 — bổ sung `lastEventAt` + provenance links sau khi phát hiện qua gọi thật — 2026-09-04

**Trạng thái: HOÀN TẤT, verify THẬT qua curl + `test:e2e` trên Docker
thật (xem "Response THẬT đã gọi (sau khi sửa" và "Verify THẬT trên Docker
thật" bên dưới).**

Sau khi Step 10 xong và đã sang máy có Docker để gọi thật
`GET /production-lines`, đối chiếu lại checklist đề bài gốc ("show: ...
Last event time and data freshness ... Links to the contributing source
records and collection run") phát hiện response thiếu 2 điều: chỉ có
`freshnessMinutes` (số tương đối) mà không có timestamp tuyệt đối, và
không có cách nào lấy được ID của source_records/collection_runs đã góp
phần tạo nên batch đó (mới chỉ có `batchId`, phải tự suy ra qua
`GET /canonical-events?batchId=` ở request khác). Máy sửa lỗi này lúc đó
**không có Docker** (khác máy đã gọi thật ở trên) — chỉ verify OFFLINE
được lúc viết code (xem "Verify OFFLINE" bên dưới); sau đó đã đưa sang
máy có Docker gọi lại thật + chạy `test:e2e` thật — xem "Verify THẬT trên
Docker thật" ở cuối entry này.

**Response thật đã gọi (batch B002, TRƯỚC khi sửa — bằng chứng của lỗi):**
```json
{
  "batchId": "B002", "state": "IN_PROGRESS", "currentStation": "RECEIVING",
  "completedQuantity": 100, "missingStations": [], "freshnessStatus": "STALE",
  "freshnessMinutes": 354534, "qualityIndicators": []
}
```

**Đã làm:**
- `ProductionLinesController` (`production-lines.controller.ts`) — thêm 2
  method private mới, KHÔNG đụng `ProductionDomainService`/
  `batch-state.ts`/`freshness.ts`/`canonicalization.service.ts`:
  - `getLastEventAt(batchId, currentStation)` — tra `canonicalEvent` theo
    `canonicalKey` (`${batchId}:${currentStation}`, unique index sẵn có)
    lấy đúng `eventTime` của canonical_event tại `currentStation`.
    `currentStation` nhận thẳng từ `BatchStatusResult` đã được
    `getBatchStatus` (Step 4/5, không sửa) tính sẵn — KHÔNG tự suy diễn
    lại Rule 6 ở đây để tránh trùng lặp logic domain.
  - `getProvenance(batchId)` — query `canonicalEventSource` lọc theo
    `canonicalEvent.batchId`, lấy `sourceRecordPk` (→
    `contributingSourceRecordIds`, dedupe qua toàn bộ trạm của batch,
    không chỉ `currentStation`) và `sourceRecord.collectionRunId` (→
    `contributingCollectionRunIds`, dedupe).
  - Cả 2 gọi song song với `getBatchStatus` bằng `Promise.all` cho mỗi
    batch — không đổi thứ tự/độ phức tạp N+1 vốn đã chấp nhận từ khi viết
    Step 10 gốc (quy mô fixture nhỏ, ưu tiên tái sử dụng đúng hơn tối ưu
    hoá truy vấn).
- `test/read-api.e2e-spec.ts` — thêm 2 test mới vào describe
  `GET /production-lines` sẵn có (dùng lại B001/B002/B006, không bịa
  scenario mới):
  - `lastEventAt` đúng `eventTime` thật của canonical_event tại
    `currentStation` — dùng B002 (RECEIVING ACCEPTED, `eventTime === T0`
    chính xác theo `batch-scenarios.ts`), assert `lastEventAt ===
    T0.toISOString()`; kèm B001 (PLANNED, không có event nào) assert
    `lastEventAt === null`.
  - `contributingSourceRecordIds`/`contributingCollectionRunIds` đúng —
    dùng B006 (2 nguồn: `Production Database` DATABASE-only 5 trạm
    RECEIVING..FOLDING + `Application API` chỉ DISPATCH, tổng 7
    `source_records`, 2 `collection_runs`), query lại thẳng qua Prisma
    trong test để lấy "expected" độc lập với code đang test, rồi so khớp
    với response — assert đúng 7 id source record + 2 id collection run,
    không thiếu/thừa.

**Response THẬT đã gọi (sau khi sửa, `GET /production-lines` trên Docker
thật — dán nguyên văn, không tóm tắt):**
```json
[
  {
    "lineId": "LINE-1",
    "stations": [
      {"station": "RECEIVING", "wip": 1, "batchIds": ["B002"]},
      {"station": "SORTING", "wip": 0, "batchIds": []},
      {"station": "WASHING", "wip": 0, "batchIds": []},
      {"station": "DRYING", "wip": 0, "batchIds": []},
      {"station": "FOLDING", "wip": 0, "batchIds": []},
      {"station": "DISPATCH", "wip": 0, "batchIds": []}
    ],
    "batches": [
      {
        "workOrderId": "WO-B002", "batchId": "B002",
        "state": "IN_PROGRESS", "currentStation": "RECEIVING",
        "completedQuantity": 100, "missingStations": [],
        "freshnessStatus": "STALE", "freshnessMinutes": 354566,
        "qualityIndicators": [],
        "lastEventAt": "2026-01-01T00:00:00.000Z",
        "contributingSourceRecordIds": [
          "32e51d6d-eba3-4f6b-98f3-fa14736626db",
          "87628b09-43a2-4d0a-a51f-e8d8bd37395e",
          "cc711dc4-8dab-4641-a1f9-3bb9aa93cd2b"
        ],
        "contributingCollectionRunIds": ["ff89e7d5-225c-4129-aa26-07e71a22da43"]
      }
    ]
  }
]
```
Đọc đúng: `lastEventAt` = `eventTime` thật của canonical_event RECEIVING
của B002 (khớp `T0` trong fixture, `2026-01-01T00:00:00.000Z`);
`contributingSourceRecordIds` có 3 phần tử — nhiều hơn ví dụ dựng tay
trước đó (1 phần tử, dựa trên fixture sạch mới truncate). Chưa xác nhận
chính xác nguyên nhân (DB dev thật trên máy Docker này có thể đã tích luỹ
qua nhiều lần chạy trước đó — `source_records` là bảng append-only tuyệt
đối, không có unique constraint trên `(source_id, source_record_id)`, xem
comment trong `schema.prisma`/mục "Đã làm" Day 2 — nên về nguyên tắc có
thể có nhiều row cho cùng 1 `batchId:station`); không kết luận vội đây là
bug vì response vẫn đúng shape và `contributingCollectionRunIds` đúng 1
phần tử hợp lý. Ghi chú lại để không quên, không chặn tiến độ — cả hai
field đều là UUID thật lấy từ DB, không còn placeholder. **Bằng chứng đây là tính toán thật, không
phải giá trị cứng**: `freshnessMinutes` tăng từ `354534` (lần gọi đầu,
"Response thật đã gọi (batch B002, TRƯỚC khi sửa" phía trên) lên
`354566` (lần gọi này, SAU khi sửa) — chênh đúng 32 phút, đúng khoảng thời
gian thực tế trôi qua giữa 2 lần gọi curl.

**Quyết định phát sinh:**
- `lastEventAt` lấy `eventTime` (thời điểm nghiệp vụ do nguồn báo cáo),
  KHÔNG lấy `canonical_events.updated_at` (thời điểm hệ thống ghi/tính
  lại record) — nhất quán với định nghĩa freshness đã có sẵn từ Step 4
  (`calculateFreshness` cũng dùng `eventTime`, không dùng `receivedAt`
  hay `updatedAt`), tránh 2 khái niệm "thời gian" lệch nhau trong cùng 1
  response.
- `contributingSourceRecordIds`/`contributingCollectionRunIds` tính trên
  TOÀN BỘ trạm của batch (không chỉ `currentStation`) — đúng câu chữ đề
  bài "the contributing source records and collection run" áp dụng cho
  cả batch, không giới hạn phạm vi ở trạm hiện tại; UI có thể cần xem lại
  provenance của các trạm đã qua, không chỉ trạm mới nhất.

**Verify OFFLINE (không cần Docker/Postgres — chỉ cần Node):**
- `npx tsc --noEmit` sạch toàn repo (không output, exit 0).
- `npm run lint` (`eslint --fix`) sạch toàn repo, không output, exit 0.
- `npm run test`: vẫn 22/22 pass, không case nào mới — dán nguyên output:
  ```
  PASS src/app.controller.spec.ts
  PASS src/modules/canonicalization/canonicalization.pipeline.spec.ts
  PASS src/modules/production-domain/batch-state.spec.ts
  PASS src/modules/production-domain/freshness.spec.ts

  Test Suites: 4 passed, 4 total
  Tests:       22 passed, 22 total
  ```
- `npm run test:e2e` lúc viết code (máy này không có Docker): chưa verify
  được, chỉ xác nhận 2 test mới (và toàn bộ suite khác) compile/collect
  được, không lỗi cú pháp/kiểu — fail đúng 1 lý do duy nhất
  `Can't reach database server at localhost:5433`, giống hệt mọi suite
  khác trong repo khi chạy ở máy không Docker. Đã verify thật sau đó — xem
  ngay bên dưới.

**Verify THẬT trên Docker thật (`npm run test:e2e`, dán nguyên văn từ
log, không tóm tắt):**
```
❯ npm run test:e2e

backend@0.0.1 test:e2e
jest --config ./test/jest-e2e.json

 PASS  test/read-api.e2e-spec.ts
 PASS  test/batch-lifecycle.e2e-spec.ts
 PASS  test/collection-runs.e2e-spec.ts
 PASS  test/database-collector.e2e-spec.ts
 PASS  test/management-events.e2e-spec.ts
 PASS  test/crawler-collector.e2e-spec.ts
 PASS  test/app.e2e-spec.ts

Test Suites: 7 passed, 7 total
Tests:       59 passed, 59 total
Snapshots:   0 total
Time:        7.929 s, estimated 8 s
Ran all test suites.
Jest did not exit one second after the test run has completed.

'This usually means that there are asynchronous operations that weren't stopped in your tests. Consider running Jest with --detectOpenHandles to troubleshoot this issue.
```
Đọc đúng: **7/7 suite pass, 59/59 test** — gồm `read-api.e2e-spec.ts`
(Step 10, cả 7 test: `GET /sources`, `GET /collection-runs?sourceId=`,
`GET /canonical-events?batchId=` + provenance, `GET /production-lines`
rollup WIP, `GET /production-lines` `lastEventAt`, `GET /production-lines`
provenance links, `STALE_THRESHOLD_MINUTES` override) cùng 6 suite cũ của
Step 5–9 vẫn pass nguyên, không suite nào bị ảnh hưởng bởi 2 field mới.
Cảnh báo `Jest did not exit... --detectOpenHandles` vẫn xuất hiện — đã
ghi nhận từ Step 6, chưa điều tra, không chặn tiến độ (không phải lỗi
mới của Step 10).

### Step 11 — Data Sources UI — 2026-09-04

**Trạng thái: build sạch (`tsc --noEmit`/`eslint`/`npm run build` đều
sạch) — CHƯA tự click-test bằng mắt trên trình duyệt thật (máy này không
có Docker, không tự chạy `docker compose up` để mở `http://localhost:3000`
thật). Chỉ làm frontend — không sửa code backend nào.**

**Audit trước khi code:**
- `frontend/` là Next.js 16.3.4 + React 19.2.8, **App Router**
  (`frontend/app/`, có `layout.tsx`/`page.tsx`/`page.module.css`, KHÔNG có
  thư mục `pages/`) — route mới thêm theo đúng convention này
  (`app/<route>/page.tsx`), không trộn Pages Router.
- `app/page.tsx` (Step 1, có sẵn) là **Client Component** (`'use client'`)
  fetch `GET /health` qua `NEXT_PUBLIC_API_URL` bằng `useEffect` +
  `useState` thuần, KHÔNG dùng Server Component data-fetching/Server
  Actions nào. Toàn bộ route mới ở Step 11 giữ đúng 1 pattern này (client
  component + fetch trực tiếp tới backend) để nhất quán, không trộn 2 kiến
  trúc data-fetching khác nhau trong cùng 1 app nhỏ.
- `AGENTS.md`/`CLAUDE.md` (tự sinh bởi `next dev`, đã có sẵn) cảnh báo
  Next.js bản này có breaking changes so với dữ liệu huấn luyện, phải đọc
  `node_modules/next/dist/docs/` trước khi viết code — đã đọc
  `01-app/01-getting-started/03-layouts-and-pages.md` và
  `01-app/03-api-reference/03-file-conventions/page.md`,
  `01-app/03-api-reference/04-functions/use-search-params.md` trước khi
  code (xem "Quyết định phát sinh" bên dưới về `params`/`searchParams` là
  `Promise` + React `use()`).
- Đọc lại `backend/README.md`'s "Nhật ký triển khai" Step 6–10 để lấy
  đúng shape response từng endpoint (không đoán field) — dùng làm ground
  truth cho `frontend/lib/api.ts` (xem "Đã làm").

**Đã làm:**
- `frontend/lib/api.ts` (mới) — 1 chỗ duy nhất định nghĩa `API_URL`, hàm
  `apiFetch<T>` dùng chung (parse lỗi theo đúng shape Nest mặc định
  `{ statusCode, message, error }`, `message` luôn là string vì backend
  không dùng `class-validator`/`ValidationPipe` ở đâu — đã xác nhận lại
  trong README Step 6), và toàn bộ type + hàm gọi API mirror đúng
  README/`backend/src/**/types.ts`:
  - `Source`/`CreateSourceDto`/`listSources`/`getSource`/`createSource`/
    `verifySource`/`discoverSource`/`selectSourceTable` (Step 6/7/8/10).
    `CreatableSourceType = 'API' | 'DATABASE' | 'CRAWLER'` — loại trừ
    `MQTT` khỏi form tạo mới (`SourceType` Prisma enum có `MQTT` nhưng
    KHÔNG collector/config shape nào cho nó tồn tại ở Step 6–8, tạo 1
    Source `MQTT` sẽ không có action nào dùng được).
  - `CollectionRun`/`CollectionRunHistoryEntry` (thêm `durationMs`, chỉ
    có ở response Step 10)/`runCollection`/`listCollectionRuns` (Step
    6/10).
  - `CanonicalEvent`/`CanonicalEventSourceLink`/`listCanonicalEvents`
    (Step 10) — đúng field `sources[]` provenance (`relationship`,
    `sourceRecordPk`, `sourceRecordId`, `sourceId`, `sourceName`,
    `sourceType`, `collectionRunId`, `eventTime`, `receivedAt`).
- `app/sources/page.tsx` (mới) — mục 1+2 checklist:
  - Bảng list `GET /sources` — name/type/verifiedAt (hoặc "chưa verify")/
    link "Manage" sang `/sources/:id`.
  - Form "Register new source" — field config đổi theo `type` chọn
    (`API`: `baseUrl`/`apiKeyEnvVar`/`fault?`; `DATABASE`:
    `host`/`port`/`database`/`user`/`passwordEnvVar`; `CRAWLER`:
    `baseUrl`/`fault?`) — **KHÔNG có input nhập password/API key thật**,
    chỉ nhập TÊN biến môi trường (`passwordEnvVar`/`apiKeyEnvVar`), đúng
    thiết kế secret handling đã có từ Step 6/7 (`Source.config` không bao
    giờ chứa secret literal). Field rỗng (`fault`) bị lọc ra trước khi
    `POST /sources`, không gửi chuỗi rỗng.
- `app/sources/[id]/page.tsx` (mới) — mục 3–7 checklist, 1 trang chi tiết
  gộp toàn bộ luồng còn lại của 1 Source:
  - "Verify connection" → `POST /sources/:id/verify` — chỉ hiện với
    `DATABASE`/`CRAWLER` (`SourcesService.verifyConnection` ném 400 cho
    `API`/`MQTT`, xem `resolveDatabaseConfig`'s type check — UI không mời
    gọi 1 action chắc chắn lỗi).
  - "Discover schema" → `GET /sources/:id/discover` — cùng điều kiện hiện
    trên. Render khác nhau theo shape trả về: bảng `table`/`columns` nếu
    là mảng (`DATABASE`), hoặc `reachable`/`totalPages` nếu là object
    (`CRAWLER`) — dùng type guard `isDiscoveredTables` (thêm vào
    `lib/api.ts`) để phân biệt, không đoán bằng field lẻ.
  - "Select table to collect" → `POST /sources/:id/select` — chỉ hiện với
    `DATABASE`; dropdown chỉ có dữ liệu SAU khi đã Discover thành công
    trong phiên hiện tại (không tự gọi lại discover ngầm) — đúng luồng
    "3. Select what should be collected" đứng sau "2. Discover".
  - "Run collection" → `POST /collection-runs` — hiện cho MỌI type (route
    backend không giới hạn type), hiển thị kết quả ngay
    (status/recordsRead/errorCount/errorMessage).
  - Bảng "Collection run history" → `GET /collection-runs?sourceId=` —
    status/duration (`durationMs`, `—` khi còn `null`)/records/errors/
    errorMessage, mỗi dòng có link "Preview" sang
    `/canonical-events?sourceId=<id>&collectionRunId=<runId>`.
- `app/canonical-events/page.tsx` (mới) — mục 8 checklist: đọc filter từ
  `searchParams` (`batchId`/`sourceId`/`collectionRunId`, dùng
  `React.use()` trên prop `searchParams: Promise<...>` của page — xem
  "Quyết định phát sinh"), gọi `GET /canonical-events?...`, render mỗi
  canonical event kèm bảng provenance đầy đủ (relationship/source name+
  type/source record id/collection run id/eventTime/receivedAt), có link
  ngược lại `/sources/:id` (theo `sourceId`) và lọc lại theo
  `collectionRunId`. Không có form filter riêng — đến từ link "Preview"
  ở trang chi tiết source, đúng gợi ý "có thể chỉ cần link đơn giản" của
  đề bài.
- Mục 9 (error handling): mọi page dùng chung pattern `phase: 'loading' |
  'success' | 'error'` (hoặc thêm `'idle'` cho action do người dùng bấm)
  — fetch fail (network/4xx/5xx) hiển thị `<p style={{color:'red'}}>`,
  KHÔNG throw ra ngoài render (mọi lỗi bắt trong `.catch`), không crash
  trắng trang.
- `app/page.tsx`: thêm 1 link `Data Sources →` sang `/sources` (thay đổi
  tối thiểu, chỉ thêm 1 dòng JSX, không đổi logic health-check có sẵn).

**Vấn đề gặp phải:**
- `tsc --noEmit` báo lỗi thật ở `app/sources/[id]/page.tsx`: dùng chung 1
  type `Action<T>` (4 nhánh `idle|loading|success|error`) cho cả state
  fetch-lúc-mount (`source`, `history`) lẫn state hành động do người dùng
  bấm (`verify`, `discover`, `select`, `run`) — sau khi early-return cho
  `loading`/`error` của `source`, TypeScript chỉ loại được 2 nhánh đó
  khỏi *type*, còn `idle` (nhánh KHÔNG BAO GIỜ thực sự xảy ra với
  `source`, vì state này luôn bắt đầu `loading` rồi fetch ngay) vẫn còn
  trong type nên `source.data` báo lỗi "does not exist on type ...
  idle". Sửa bằng cách tách riêng 1 type `LoadState<T>` (3 nhánh, không có
  `idle`) dùng cho `source`/`history`, giữ `Action<T>` (4 nhánh) cho 4
  action còn lại — đúng bản chất 2 loại state khác nhau, không phải ép
  kiểu qua loa.
- `eslint` (rule mới `react-hooks/set-state-in-effect`, có trong
  `eslint-config-next@16.3.4`) báo lỗi ở cả 3 trang: gọi `setState({phase:
  'loading'})` làm câu lệnh ĐỒNG BỘ ngay trong thân `useEffect` (hoặc
  trong 1 hàm được gọi trực tiếp, đồng bộ, từ trong `useEffect`) bị coi là
  anti-pattern (cascading render) theo rule mới này. Sửa bằng cách tách
  mỗi cặp `fetchX`/`refreshX`: `fetchX()` chỉ fetch + `setState` bên trong
  `.then`/`.catch` (không có `setState` đồng bộ nào ở đầu hàm — dùng cho
  effect lúc mount, vì `useState` khởi tạo sẵn `{ phase: 'loading' }` nên
  không cần set lại); `refreshX()` = `setState({phase:'loading'})` rồi
  gọi `fetchX()` (dùng cho các event handler sau khi mutate dữ liệu —
  KHÔNG nằm trong effect nên rule này không áp dụng). `useEffect` giờ chỉ
  gọi thẳng `fetchX`, không qua `refreshX` nữa.

**Quyết định phát sinh:**
- `params`/`searchParams` của page là `Promise` (xác nhận qua
  `node_modules/next/dist/docs`, không phải đoán/nhớ từ bản Next cũ) —
  đọc bằng React's `use()` hook ngay trong Client Component page
  (`app/sources/[id]/page.tsx`'s `use(params)`,
  `app/canonical-events/page.tsx`'s `use(searchParams)`), theo đúng
  pattern tài liệu chính thức liệt kê cho Client Component pages — KHÔNG
  dùng `useSearchParams()` hook (cách đó đòi hỏi bọc `<Suspense>` để
  tránh lỗi prerender, phức tạp hơn cần thiết cho phạm vi Step 11).
- KHÔNG dùng helper type `PageProps<'/route/[param]'>` (Next 16 có auto-
  generate type này, thấy trong tài liệu và trong `layout.tsx` có sẵn
  dùng `LayoutProps<"/">`) — dùng thẳng type `Promise<{...}>` viết tay,
  vì `PageProps` chỉ được sinh ra SAU khi chạy `next dev`/`next build`
  lần đầu cho route đó; viết tay tránh phụ thuộc thứ tự chạy lệnh, chắc
  chắn đúng ngay cả trước khi build lần đầu.
- 1 trang chi tiết Source duy nhất (`/sources/:id`) gộp cả 5 action
  (verify/discover/select/run/history) thay vì tách nhiều trang con — vì
  các action này phụ thuộc lẫn nhau theo đúng thứ tự luồng đề bài
  (discover → select cần state discover vẫn còn trên cùng 1 trang), tách
  trang sẽ phải truyền state qua URL/localStorage không cần thiết.
- Không tạo trang `/sources/new` riêng — form "Register" nằm ngay trên
  `/sources` (list + form cùng 1 trang) — đơn giản hơn, đúng tinh thần
  "KHÔNG polish thừa" của đề bài, danh sách source thường ít (fixture/dev
  scale), không cần trang riêng.
- `MQTT` bị loại khỏi `type` mà form "Register" cho chọn (chỉ
  `API`/`DATABASE`/`CRAWLER`) — dù `SourceType` Prisma enum cho phép, tạo
  1 Source `MQTT` qua UI sẽ không có action nào (verify/discover/select/
  collect) thực sự dùng được, chỉ gây nhầm lẫn.
- Provenance table ở `/canonical-events` có link ngược `sourceId` →
  `/sources/:id` và link `collectionRunId` → lọc lại
  `/canonical-events?collectionRunId=` — tận dụng đúng field đã có sẵn
  trong response Step 10, không cần thêm endpoint mới nào.

**Verify OFFLINE (frontend, không cần Docker):**
- `npx tsc --noEmit` sạch (không output, exit 0).
- `npx eslint` sạch (không output, exit 0) — sau khi sửa
  `react-hooks/set-state-in-effect` ở cả 3 trang mới.
- `npm run build` thành công, dán nguyên output:
  ```
  > frontend@0.1.0 build
  > next build

  ▲ Next.js 16.3.4 (Turbopack)
  ✓ Running next.config.ts took 129ms

    Creating an optimized production build ...
  ✓ Compiled successfully in 4.5s
    Running TypeScript ...
    Finished TypeScript in 1890ms ...
    Collecting page data using 8 workers ...
    Generating static pages using 8 workers (0/6) ...
  ✓ Generating static pages using 8 workers (6/6) in 702ms
    Finalizing page optimization ...

  Route (app)
  ┌ ○ /
  ├ ○ /_not-found
  ├ ƒ /canonical-events
  ├ ○ /sources
  └ ƒ /sources/[id]

  ○  (Static)   prerendered as static content
  ƒ  (Dynamic)  server-rendered on demand
  ```
  Đọc đúng: đủ 3 route mới (`/canonical-events`, `/sources`,
  `/sources/[id]`) build thành công. `/canonical-events` và
  `/sources/[id]` là **ƒ Dynamic** (đúng kỳ vọng — phụ thuộc
  `searchParams`/route param tại request time); `/sources` là **○
  Static** (shell tĩnh, fetch dữ liệu hoàn toàn phía client sau khi
  trang tải, giống `/` có sẵn từ Step 1).
- **CHƯA click-test bằng mắt trên trình duyệt thật** — máy này không có
  Docker để `docker compose up` + mở `http://localhost:3000` thật. Phần B
  (Definition of Done) để lại cho máy có Docker.

### Step 11 — bổ sung 3 fix sau khi test tay UI thật — 2026-09-04

**Trạng thái: build/test sạch offline (`tsc --noEmit`/`eslint`/`npm run
test`/`npm run build` cho cả 2 workspace) — máy này KHÔNG có Docker nên
KHÔNG tự re-test lại 3 fix này bằng mắt; người dùng cần tự click lại trên
máy có Docker.**

Sau khi tự click-test tay đủ luồng trên máy có Docker (theo checklist
"Việc cần làm ở máy có Docker", mục Step 11 bên dưới), phát hiện 3 vấn đề
thật, ghi lại đầy đủ:

**1. Source "Supplier Portal (fixture)" trỏ tới port ephemeral đã chết —
KHÔNG phải từ `prisma/seed.ts`:**
- Grep `"127.0.0.1"` và `.listen(0)` toàn repo (loại `node_modules`) chỉ
  ra ĐÚNG 2 chỗ, cả 2 đều trong `backend/test/`:
  `crawler-collector.e2e-spec.ts` (dòng tạo `portalServer`/`portalBaseUrl`
  + hàm `createCrawlerSource()` đặt tên Source cứng
  `'Supplier Portal (fixture)'`) và `collection-runs.e2e-spec.ts` (cùng
  pattern cho `fixtureServer`/`fixtureApiBaseUrl`, Source
  `'Application API (fixture)'`/`'Application API (secret regression
  test)'`). **`prisma/seed.ts` đọc lại từ đầu xác nhận KHÔNG hề tạo Source
  CRAWLER nào cả** (chỉ tạo `Production Database` DATABASE và
  `Application API` API qua `buildBatchScenarios`, cả 2 với
  `config: {}` rỗng — cũng không dùng Verify/Discover được, xem ghi chú
  cuối mục này).
- Nguyên nhân thật: mỗi file `*.e2e-spec.ts` chạm Postgres thật đều
  `beforeEach(() => truncateAll(prisma))` (xoá TRƯỚC mỗi test) nhưng
  KHÔNG có `afterAll` xoá lại — dòng Source do TEST CUỐI CÙNG của suite
  tạo ra (trỏ tới server in-process ephemeral-port) tồn tại vĩnh viễn
  trong DB dev sau khi suite chạy xong, và server đó đã đóng ngay sau đó
  → baseUrl chết thật. Đây là hệ quả trực tiếp của khoảng trống đã ghi
  nhận từ Step 6 ("Việc chưa xong": "Mỗi lần chạy verify-step6.sh... để
  lại 1 row rác trong DB dev") — Step 11 là lần đầu khoảng trống này thật
  sự gây lỗi chức năng nhìn thấy được qua UI (không chỉ "rác" vô hại).
- Fix:
  - `backend/test/crawler-collector.e2e-spec.ts` +
    `backend/test/collection-runs.e2e-spec.ts`: thêm
    `await truncateAll(prisma)` vào đầu `afterAll` (trước `app.close()`,
    vì `PrismaService.onModuleDestroy` gọi `$disconnect()`) — suite tự
    dọn sạch sau khi chạy xong, không còn để lại Source ephemeral-port
    nào nữa từ lần chạy `test:e2e` SAU khi fix này (không giúp DB ĐÃ bị
    nhiễm từ trước — xem "re-seed" bên dưới).
  - `backend/prisma/seed.ts`: thêm 1 Source CRAWLER THẬT dùng được qua UI
    — `name: 'Supplier Portal'`, `config: { baseUrl:
    'http://supplier-portal:4200' }` (tên service + port nội bộ Docker
    network, đúng pattern `fixture-api:4000` đã dùng trong
    `docker-compose.yml`, KHÔNG BAO GIỜ port ephemeral). Trước fix này,
    `npm run seed` không tạo Source CRAWLER nào cả — nguồn CRAWLER duy
    nhất người dùng từng thấy là dòng rác từ test leak ở trên.
  - **Ghi chú thêm (chưa fix, ngoài phạm vi 3 việc được giao)**: 2 Source
    `Production Database`/`Application API` mà `buildBatchScenarios`
    seed cũng có `config: {}` rỗng — Verify/Discover/Run collection trên
    2 dòng này qua UI cũng sẽ lỗi (thiếu `passwordEnvVar`/`baseUrl`/
    `apiKeyEnvVar`). Không sửa ở đây vì không nằm trong 3 việc được giao;
    ghi lại để không quên.
- **`npm run seed` KHÔNG idempotent** (đã ghi rõ ngay trong comment đầu
  file, không phải phát hiện mới): `work_order_id`/`batch_id` có unique
  constraint, `buildBatchScenarios` luôn tạo `WO-B001..WO-B008` cố định
  → chạy `npm run seed` lần 2 trên DB đã seed sẽ FAIL ngay ở record đầu
  tiên bị trùng, KHÔNG chạy tới được dòng tạo Source CRAWLER mới thêm ở
  trên. Cách áp dụng fix cho 1 DB dev ĐÃ có sẵn dữ liệu (chọn 1 trong 3,
  không cái nào tự động chạy được vì máy này không có Docker):
  1. **Khuyên dùng nếu chỉ cần fix nhanh, không mất dữ liệu khác**: xoá
     tay đúng 1 dòng rác qua Prisma Studio/psql (`DELETE FROM sources
     WHERE name = 'Supplier Portal (fixture)'`), rồi tự đăng ký 1 Source
     CRAWLER mới qua UI Step 11 (`/sources`, type `CRAWLER`, baseUrl
     `http://supplier-portal:4200`) — không cần re-seed gì cả.
  2. **Nếu muốn có sẵn đúng Source `Supplier Portal` do seed script tạo**:
     `UPDATE sources SET config = '{"baseUrl":"http://supplier-portal:4200"}',
     name = 'Supplier Portal' WHERE name = 'Supplier Portal (fixture)'`
     (sửa tay 1 dòng, giữ nguyên toàn bộ dữ liệu khác).
  3. **Muốn DB sạch hoàn toàn theo đúng seed mới**: xoá sạch dữ liệu
     (TRUNCATE toàn bộ bảng liên quan, xem `test/fixtures/db-utils.ts`
     làm tham chiếu danh sách bảng) rồi `npm run seed` lại từ đầu — mất
     hết dữ liệu đã tạo tay qua UI trước đó, chỉ dùng nếu chấp nhận điều
     này.

**2. Lỗi nghiệp vụ backend bị Nest ẩn thành "Internal server error":**
- Xác nhận qua UI thật: các lỗi như "references env var ... but it is
  not set", "has no selectedTable configured" chỉ hiện
  "Internal server error" chung chung trên UI, khác hẳn lỗi mạng (crawler
  fetch failed) vốn hiện đúng message thật.
- Nguyên nhân: NestJS's default exception filter chỉ giữ nguyên
  `message` cho subclass của `HttpException` (`BadRequestException`,
  `NotFoundException`,...) — bất kỳ giá trị nào khác ném ra (kể cả `throw
  new Error(...)` với message rõ ràng) đều bị filter mặc định thay thế
  bằng `{ statusCode: 500, message: "Internal server error" }` (cố ý, để
  không rò rỉ chi tiết nội bộ của lỗi KHÔNG lường trước). `backend/src/main.ts`
  không có exception filter tuỳ chỉnh nào — xác nhận hành vi mặc định của
  Nest đang áp dụng, không phải bug ở tầng filter riêng nào. `frontend/lib/api.ts`
  (`apiFetch`) đọc đúng field `message` từ body — không có bug ở tầng
  fetch helper, nó chỉ đang hiển thị trung thực đúng message mà backend
  trả về (vốn đã bị Nest thay bằng chuỗi chung chung từ trước khi tới
  frontend).
- Grep `throw new Error(` toàn `backend/src` tìm ra đúng 5 chỗ, sửa 4 —
  chỗ còn lại (`canonicalization.pipeline.ts`'s `resolveGroup requires at
  least one record`) là bất biến nội bộ của pure function (không bao giờ
  thật sự xảy ra từ input HTTP hợp lệ), cố tình GIỮ NGUYÊN `Error` thường
  — nếu nó thật sự throw, đó là bug thật trong code (không phải lỗi cấu
  hình người dùng), 500 chung chung là đúng hành vi mong muốn cho trường
  hợp đó, không nên "làm đẹp" thành 400:
  - `sources.service.ts`'s `resolveDatabaseConfig` — thiếu
    `passwordEnvVar` (dùng bởi `verifyConnection`/`discoverSchema`/
    `selectTable`) → `BadRequestException`.
  - `collection-runs.service.ts`'s `runApiCollection` — thiếu
    `apiKeyEnvVar` → `BadRequestException`.
  - `collection-runs.service.ts`'s `runDatabaseCollection` — thiếu
    `passwordEnvVar` → `BadRequestException`.
  - `collection-runs.service.ts`'s `runDatabaseCollection` — chưa
    `selectedTable` → `BadRequestException`.
  - Cả 4 chỗ đều throw TRƯỚC khi `prisma.collectionRun.create()` (nếu có)
    chạy — đã kiểm tra kỹ trước khi sửa, đổi sang `BadRequestException`
    không để lại row `RUNNING` mồ côi nào trong `collection_runs`.

**3. Action "Select" không có xác nhận thành công:**
- Xác nhận qua UI thật: bấm "Select" xong không có phản hồi trực quan gì
  (khác "Verify" — có dòng xanh), gây nhầm tưởng đã chọn bảng xong nhưng
  thực ra chưa, dẫn tới lỗi thật ở bước "Run collection" sau đó ("has no
  selectedTable configured" — đúng lỗi đã sửa ở mục 2, vòng lặp nhân quả
  giữa 2 bug này khiến việc test tay ban đầu càng khó hiểu).
- Fix: `frontend/app/sources/[id]/page.tsx` — thêm dòng xác nhận màu xanh
  khi `select.phase === 'success'` (`Select thành công: bảng "..." lúc
  ...`), cùng pattern với khối xác nhận đã có của Verify.

**Verify OFFLINE (backend):**
- `npx tsc --noEmit` sạch (không output, exit 0).
- `npm run lint` sạch (không output, exit 0).
- `npm run test`: vẫn 22/22 pass, không case nào mới — dán nguyên output:
  ```
  PASS src/modules/production-domain/freshness.spec.ts
  PASS src/modules/production-domain/batch-state.spec.ts
  PASS src/modules/canonicalization/canonicalization.pipeline.spec.ts
  PASS src/app.controller.spec.ts

  Test Suites: 4 passed, 4 total
  Tests:       22 passed, 22 total
  ```
- `npm run test:e2e` — chưa chạy lại ở lượt này (máy không có Docker);
  `tsc --noEmit`/`eslint` đã quét cả `test/` (tsconfig không loại trừ
  `test/`, `eslint` script chạy trên `{src,apps,libs,test}`) nên 2 file
  `*.e2e-spec.ts` vừa sửa (`afterAll` thêm `truncateAll`) đã được xác
  nhận không có lỗi biên dịch/cú pháp, chỉ chưa verify hành vi thật.

**Verify OFFLINE (frontend):**
- `npx tsc --noEmit` sạch (không output, exit 0).
- `npx eslint` sạch (không output, exit 0).
- `npm run build` thành công, cùng 3 route như entry Step 11 gốc ở trên
  (`/canonical-events` ƒ, `/sources` ○, `/sources/[id]` ƒ) — không route
  nào đổi shape, chỉ thêm 1 khối JSX xác nhận Select.

**CHƯA click-test lại 3 fix này bằng mắt trên trình duyệt thật** — máy
sửa lỗi này không có Docker. Người dùng cần tự re-test tay trên máy có
Docker (theo mục checklist Step 11 bên dưới), đặc biệt xác nhận: Source
`Supplier Portal` (seed mới) Verify/Discover/Run collection thành công
thật; message lỗi thật hiện đúng khi thiếu env var/selectedTable (không
còn "Internal server error"); dòng xanh xác nhận hiện sau khi Select.

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
- [x] **Step 7 — đã verify thật.** `cd backend && npx prisma migrate dev`
      (cột `sources.verified_at`), `docker compose up -d --build` (cả 4
      service `backend`/`postgres`/`fixture-api`/`production-db` lên
      `healthy`), rồi `npm run test:e2e` — PASS thật, 31/31 test, 4 suite
      (`database-collector.e2e-spec.ts` + 3 suite cũ) — xem entry "Step 7 —
      HOÀN TẤT, verify thật trên Postgres thật" bên trên cho bằng chứng log
      thật đầy đủ. Lần chạy đầu tiên FAIL vì thiếu
      `PRODUCTION_DB_PASSWORD` trong `backend/.env`, đã sửa (xem "Vấn đề
      gặp phải" trong entry đó). Chưa có `scripts/verify-step7.sh` riêng
      (ngoài phạm vi bắt buộc của prompt Step 7) — có thể viết sau, theo
      đúng pattern `scripts/verify-step6.sh` nếu thấy cần lặp lại verify
      nhiều lần.
- [x] **Step 8 — đã verify thật.** `docker compose up -d --build` (cả 5
      service `backend`/`postgres`/`fixture-api`/`production-db`/
      `supplier-portal` lên `healthy`), rồi `npm run test:e2e` — PASS
      thật, 38/38 test, 5 suite (`crawler-collector.e2e-spec.ts` + 4 suite
      cũ) — xem entry "Step 8 — HOÀN TẤT, verify thật trên Docker thật"
      bên trên cho bằng chứng log thật đầy đủ, gồm cả 1 lần gọi thật
      `fault=malformed` xác nhận đúng hành vi skip-row-không-fail-run.
      Không có migration Prisma mới ở Step 8 nên không gặp lại cạm bẫy
      #11.
- [x] **Step 9 — đã verify thật.** Không có migration Prisma mới ở Step 9
      (bảng `management_events` đã có sẵn từ Step 2) nên không gặp lại
      cạm bẫy #11. `docker compose up -d --build` (cả 5 service lên
      `healthy`, Step 9 không thêm service mới), rồi `npm run test:e2e` —
      PASS thật, 52/52 test, 6 suite (`management-events.e2e-spec.ts` + 5
      suite cũ) — xem entry "Step 9" bên trên cho bằng chứng log thật đầy
      đủ, gồm cả 3 lệnh gọi HTTP thật (BLOCK, RESUME sau BLOCK, và RESUME
      trên batch chưa từng bị block → 400 — validation quan trọng nhất
      của Step 9, xác nhận đúng bằng gọi thật, không chỉ qua Jest).
- [x] **Step 10 — đã verify thật.** Không có migration Prisma mới (chỉ
      thêm route đọc + 1 env var mới `STALE_THRESHOLD_MINUTES`).
      `docker compose up -d --build`, rồi `npm run test:e2e` — PASS thật,
      59/59 test, 7 suite (`read-api.e2e-spec.ts` + 6 suite cũ) — xem
      entry "Step 10 — bổ sung `lastEventAt` + provenance links sau khi
      phát hiện qua gọi thật" bên trên cho bằng chứng log/curl thật đầy
      đủ, gồm cả response thật của `GET /production-lines` (với
      `lastEventAt`/`contributingSourceRecordIds`/
      `contributingCollectionRunIds`, UUID thật, không placeholder) và
      2 lần gọi cách nhau ~32 phút chứng minh `freshnessMinutes` tính
      động, không phải giá trị cứng.
- [x] **Step 11 — đã test tay, tìm ra 3 bug thật, đã sửa (xem entry "Step
      11 — bổ sung 3 fix sau khi test tay UI thật" bên trên).** Test tay
      trên `http://localhost:3000/sources` phát hiện: (1) Source
      "Supplier Portal (fixture)" seed sai — thật ra là rác leak từ
      `crawler-collector.e2e-spec.ts`, không phải từ `prisma/seed.ts`;
      (2) lỗi nghiệp vụ backend (thiếu env var, chưa selectedTable) hiện
      "Internal server error" chung chung thay vì message thật; (3) nút
      "Select" không có xác nhận thành công. Cả 3 đã sửa offline (backend
      `tsc`/`eslint`/`npm run test` sạch, frontend `tsc`/`eslint`/`npm run
      build` sạch) — xem entry đó cho chi tiết đầy đủ.
- [ ] **Step 11 — chưa re-test lại 3 fix trên, cần máy có Docker.**
      `docker compose up -d --build` (build lại image backend/frontend
      với code vừa sửa). Nếu DB dev đã có sẵn dữ liệu cũ: áp dụng 1 trong
      3 cách xử lý Source "Supplier Portal (fixture)" liệt kê trong entry
      "Step 11 — bổ sung..." (xoá tay + tạo lại qua UI, hoặc UPDATE tay,
      hoặc truncate + `npm run seed` lại — `npm run seed` KHÔNG idempotent,
      xem entry đó). Xác nhận lại: Source `Supplier Portal` (seed mới,
      nếu re-seed) Verify/Discover/Run collection thành công thật qua
      `http://supplier-portal:4200`; thử 1 kịch bản thiếu env var (ví dụ
      chưa set `PRODUCTION_DB_PASSWORD`) → UI hiện đúng message thật,
      không còn "Internal server error"; bấm Select → thấy dòng xanh xác
      nhận. Sau khi re-test xong: sửa lại đúng entry "Step 11 — bổ sung..."
      (đổi trạng thái + dán bằng chứng thật), rồi mới đề xuất commit
      message thứ 2 cho phần verify.
