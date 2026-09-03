# HANDOFF — Celesnity Factory Platform

File này để dán vào một đoạn chat Claude mới (có hoặc không có Claude Code)
nếu đoạn chat hiện tại bị mất — không phụ thuộc lịch sử hội thoại. Đọc file
này trước, sau đó đọc `docs/plan-v4.md` (ground truth thiết kế) và
`README.md` **ở gốc repo** (không phải `backend/README.md` — xem mục 6).

## 1. Bối cảnh

- Dự án: Celesnity Technical Take-Home Assessment, Software Track — Factory
  Data and Production Line Platform.
- Deadline: **Chủ nhật 06/09/2026, 11:00 sáng giờ Việt Nam (UTC+7)**.
- Repo: `celesnity-factory-platform`.
- Stack bắt buộc: NestJS 11 (backend), Next.js 16 + React 19 (frontend),
  PostgreSQL 16, Docker Compose, Prisma làm ORM/migration.
- Thiết kế (data model, Domain Rules v2.2) đã chốt qua **nhiều vòng phản
  biện kỹ thuật trước khi code** — không tự suy diễn lại, mọi thứ nằm trong
  `docs/plan-v4.md`.

## 2. Thứ tự đọc để hiểu dự án

1. File này (quy ước làm việc, cạm bẫy đã gặp).
2. `docs/plan-v4.md` — kiến trúc, 9 bảng data model, Domain Rules v2.2
   (Rule 1–7 + 5b), bảng 10 fixture scenario (B001–B008, B005A, B005B, B006).
3. `README.md` ở gốc repo, mục "Trạng thái hiện tại" (tóm tắt nhanh) rồi
   "Nhật ký triển khai" (log chi tiết từng Step, đã làm gì / vấn đề gặp phải
   / quyết định phát sinh — đây là nguồn sự thật về **những gì đã code**,
   không suy đoán).

## 3. Quy tắc bất di bất dịch khi soạn prompt cho Claude Code

- **Claude Code KHÔNG BAO GIỜ chạy lệnh git** (init/add/commit/push/branch).
  Người dùng tự làm toàn bộ. Việc duy nhất liên quan git: Claude Code đề
  xuất 1 commit message (Conventional Commits) ở cuối mỗi Step.
- Mỗi prompt Step phải: (a) trỏ về `docs/plan-v4.md` làm ground truth, (b)
  giới hạn phạm vi rõ ràng (liệt kê CHỈ làm gì, KHÔNG làm gì), (c) yêu cầu
  cập nhật `README.md` **ở gốc** theo đúng format "Nhật ký triển khai" đã
  dùng xuyên suốt (Đã làm / Vấn đề gặp phải / Quyết định phát sinh), (d) có
  Definition of Done rõ ràng, kiểm được.
- Việc đầu tiên trong MỌI prompt (trước cả phần "Bối cảnh"): dặn Claude Code
  `cd backend && npm install` trước khi làm gì khác — xem lý do ở mục 5.
- Không tin lời tóm tắt của Claude Code cho các hạng mục cần môi trường thật
  (Docker/Postgres) — luôn yêu cầu dán log/output thật, tự đọc log đó thay
  vì chỉ đọc câu tóm tắt. Đã có nhiều lần tóm tắt đúng nhưng chưa đủ bằng
  chứng (ví dụ "10 scenario pass" hoá ra gộp chung 1 `it()`, phải tách
  `test.each` mới thấy hết; Step 6 từng có 3 vòng "đã sửa xong" liên tiếp
  mà mỗi lần verify thật lại lộ ra lỗi mới — xem mục 5).

## 4. Hai máy, một Docker chập chờn

- **Máy Windows/desktop**: không có Docker chạy được (Docker Desktop hỏng,
  chưa sửa). Phần lớn code thuần logic được viết ở đây, verify offline
  (`tsc --noEmit`, `eslint`, `npm run test` — không cần DB). Máy này cũng
  không có Claude Code cài sẵn ở một số thời điểm — khi đó người dùng tự
  chạy lệnh tay theo hướng dẫn từ chat.
- **Máy có Docker** (Mac, dùng đường dẫn `/Users/nguyentriet/Desktop/...`):
  dùng để verify mọi thứ cần Postgres thật (migration, integration test,
  seed). Bản thân Docker Desktop trên máy này **cũng từng tự crash/tắt** —
  không phải luôn ổn định.
- **Phương án dự phòng nếu cả 2 máy đều không có Docker sống**: GitHub
  Codespaces. Repo đã có sẵn `.devcontainer/devcontainer.json` (attach vào
  service `backend` trong `docker-compose.yml`, forward port 3001/3000) từ
  Step 1 — mở Codespaces là chạy được ngay, không cần cấu hình thêm.
- **Bài học quan trọng nhất, đã gây lỗi nhiều lần**: `node_modules` không
  nằm trong git. Sau MỌI lần `git pull` sang máy khác, phải `npm install`
  lại trong `backend/` trước khi chạy gì — nếu không, `node_modules` cũ
  trên máy đó có thể lệch version với `package.json` mới (đã gây lỗi
  `jest 30.x` vs `ts-jest` yêu cầu `29.x` — xảy ra y hệt trên cả 2 máy
  riêng biệt vì cùng lý do này).

## 5. Cạm bẫy kỹ thuật đã gặp (đọc trước khi debug lại từ đầu)

| # | Triệu chứng | Nguyên nhân thật | Đã sửa bằng |
|---|---|---|---|
| 1 | `docker compose up` báo port 5432 đã bị chiếm | Postgres của project khác (LightED) đang giữ port 5432 trên host | Remap `docker-compose.yml`: `"5433:5432"` (chỉ đổi host port, container nội bộ vẫn 5432) |
| 2 | Container backend crash `MODULE_NOT_FOUND: /app/dist/main.js` | `prisma/seed.ts` import `test/fixtures/...` → tsc kéo cả `prisma/`+`test/` vào compile qua import graph (dù đã `exclude`) → `rootDir` bị tsc tự suy rộng ra `backend/` thay vì `src/` → `dist/` bị lồng thêm 1 cấp (`dist/src/main.js`) | Thêm `"prisma"` vào `exclude` của `tsconfig.build.json` |
| 3 | `test:e2e` báo "Module ts-jest ... was not found" | `jest` bị cài lệch lên `30.x` (không tương thích `ts-jest@29.x`) — xảy ra độc lập trên cả 2 máy vì cùng nguyên nhân ở mục 4 | Ghim `"jest": "^29.7.0"` trong `package.json`, `npm install` lại |
| 4 | VS Code báo 32 lỗi `Cannot find name 'expect'/'it'` trong file test | KHÔNG phải lỗi thật (Jest tự inject global runtime) — chỉ là editor/type-check; `tsconfig.build.json` exclude hẳn `test/` nên các claim "tsc sạch" trước đó chưa từng chạm file test | Không cần sửa gấp — biết đây là nhiễu editor, không chặn `npm run test`/`test:e2e` chạy thật |
| 5 | Nghi ngờ `npm install prisma@latest` | `latest` là `8.0.0-rc.x`, đổi hẳn CLI surface (không còn `migrate dev`/`format`/`validate` cổ điển) | Ghim `prisma`/`@prisma/client` ở `6.19.3` |
| 6 | Enum `SourceType` trong `types.ts` viết tay lệch thứ tự so với `schema.prisma` | Viết tay 2 nơi độc lập (Step 2 vs Step 3), không có gì tự động đối chiếu | Đối chiếu tay theo yêu cầu tường minh mỗi khi nghi ngờ — không có cơ chế tự động, cần chủ động hỏi |
| 7 | `backend/README.md` không phải file log thật | Đây là boilerplate mặc định `nest new` tự sinh ra ở Step 1, chưa dọn. File log thật nằm ở **gốc repo** | Luôn `cat` đúng `README.md` ở gốc, không phải trong `backend/`. Cân nhắc xoá/rút gọn `backend/README.md` sau (không gấp) |
| 8 | Step 6: `POST /sources` trả `404 Cannot POST /sources` khi gọi thật qua script verify | Container backend đang chạy image Docker **cũ**, build trước khi Step 6 thêm route/handler thật — SourcesController bản cũ rỗng, tự 404 mọi method | Thêm bước preflight `docker compose up -d --build` + vòng lặp chờ `/health` trả 200 vào `scripts/verify-step6.sh`, trước khi chạy bất kỳ verify nào khác |
| 9 | Step 6: `fetch is not defined` khi gọi fixture-api từ trong container | **Chẩn đoán ban đầu SAI** — tưởng do `fetch` global không tồn tại, nên đổi sang `import { fetch } from 'undici'`. Thực ra nguyên nhân thật trùng với # 8 (image cũ) — Node 22-alpine có `fetch` global ổn định sẵn (stable từ Node 21), không cần `undici` làm dependency | Sau khi xác nhận qua `npm ls undici` (chỉ 1 bản, không trùng version) và log container thật (code chạy qua đoạn fetch bình thường), **revert lại dùng `fetch` global**, gỡ `undici` khỏi `package.json` |
| 10 | Step 6: thêm `undici` (# 9) làm 2/3 e2e suite crash ngay lúc load module: `TypeError: webidl.util.markAsUncloneable is not a function` | Gói `undici` (npm) xung đột với bản `undici` nội bộ mà Node dùng để cấp `fetch` global — 2 instance trong cùng process/vm realm của Jest | Revert # 9 giải quyết luôn lỗi này — không cần sửa riêng |
| 11 | **Nghiêm trọng nhất.** Step 6: `npx prisma migrate dev` để thêm cột `error_message` liên tục đòi `migrate reset` (xoá sạch DB dev), dù `npx prisma migrate status` báo "up to date" | Migration `20260902132930_init_schema` (tạo ở Step 2, trên máy Mac) đã áp dụng thật vào Postgres — có ghi nhận trong bảng `_prisma_migrations` — nhưng **thư mục `prisma/migrations/` chưa từng được `git add`**, kể cả trên chính máy tạo ra nó. Repo hoàn toàn không có lịch sử migration nào dù DB thật có đủ 9 bảng đúng schema. Prisma so migration files cục bộ (gần như rỗng) với DB thật (đầy đủ) → tưởng cần tạo lại từ đầu | **Baselining, không mất data:** (1) backup `pg_dump` phòng hờ; (2) `npx prisma db pull` để lấy đúng schema THẬT hiện tại (chưa có cột mới); (3) tạo `prisma/migrations/0_init/`, sinh SQL bằng `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`; (4) `prisma migrate resolve --applied 0_init`; (5) khôi phục lại `schema.prisma` đúng (có cột mới); (6) `_prisma_migrations` lúc này có 2 dòng lịch sử (`init_schema` cũ + `0_init` mới) khớp cùng 1 trạng thái DB → **xoá dòng thừa `init_schema` cũ** bằng `DELETE FROM _prisma_migrations WHERE migration_name = '...'` (chỉ là bảng sổ sách nội bộ Prisma, không đụng data thật); (7) `npx prisma migrate dev --name ...` chạy sạch, chỉ sinh đúng phần thay đổi thật |

**Quy tắc rút ra từ #11 — áp dụng cho mọi Step còn lại (7, 8, ...):** sau
MỌI lần `prisma migrate dev` tạo migration mới, chạy `git status` NGAY để
xác nhận file migration đã được track — đừng đợi đến lần cần migration
tiếp theo mới phát hiện ra đã bị bỏ sót.

## 6. Quyết định thiết kế đáng nhớ (không lặp lại trong docs/plan-v4.md)

- `SourceLinkResult.sourceRecordId` → đổi tên thành `sourceRecordPk` (Step
  4) vì dễ nhầm với `SourceRecordInput.sourceRecordId` (business identifier,
  ý nghĩa khác hẳn) — giá trị đúng từ đầu, chỉ là tên gây hiểu lầm.
- Pipeline canonicalization dùng thiết kế **2 pha** khi resolve 1 group:
  gộp theo `sourceId` trước (last-observed-wins, Rule 5.2), rồi mới so tier
  giữa các "representative" (Rule 5.3–5.5) — tránh trường hợp 1 nguồn tự
  re-read bị hiểu nhầm thành CONFLICT.
- Cross-source conflict thật (2 nguồn khác nhau, cùng lúc) trong thiết kế
  hiện tại chỉ khả thi ở DISPATCH (Production Database + Application API,
  cùng Tier 1) — đây là **lựa chọn phạm vi**, không phải ràng buộc của đề
  (Application API fixture thật ra cũng chứa "receiving records", chỉ là
  cố tình không đưa vào canonicalization của RECEIVING để giữ độ phức tạp
  hợp lý trong 4 ngày).
- `acknowledged` của quality indicator KHÔNG có cột riêng trong schema — suy
  ra từ việc có `management_events.action = ACK_EXCEPTION` với `timestamp`
  sau `canonical_events.updated_at` hay không.
- `getBatchStatus` (Step 4, pure) đổi tên thành `computeBatchStatus` ở Step
  5 để nhường tên `getBatchStatus` cho bản DB-backed mới — bản pure vẫn
  dùng nguyên logic cũ, chỉ đổi tên.
- Step 6: `Source.config` chỉ lưu **tên** biến môi trường chứa API key
  (`apiKeyEnvVar`), không bao giờ lưu giá trị thật — `CollectionRunsService`
  tự resolve từ `process.env` tại thời điểm gọi. `sanitize-config.ts` thêm
  1 lớp redact phòng thủ trên response API.
- Step 6: `CollectionRunsService.runCollection()` dùng lại nguyên
  `CanonicalizationService.ingestBatch()` từ Step 5, không viết lại logic
  canonicalization.

## 7. Công cụ hỗ trợ đã có

- `scripts/verify-step6.sh` (chạy bằng `npm run verify:step6` trong
  `backend/`) — 1 lệnh duy nhất, làm 3 việc: (1) `docker compose up -d
  --build` + chờ `/health` 200 (tránh cạm bẫy #8), (2) `npm run test:e2e`
  đầy đủ, (3) 1 lần gọi thật `POST /sources` → `POST /collection-runs` với
  `fault=500-once`, kèm tail log backend cùng lúc để bắt bằng chứng retry
  thật. Output: 1 file `step6-verification-<timestamp>.log` ở gốc repo —
  luôn đọc thật file này, đừng chỉ tin dòng CONCLUSION cuối. Nên tái sử
  dụng/mở rộng pattern này cho Step 7, 8 thay vì viết lại từ đầu.
- 2 vấn đề nhỏ CHƯA xử lý, không chặn tiến độ nhưng nên nhớ:
  - Cảnh báo `Jest did not exit... Consider running with
    --detectOpenHandles` sau `test:e2e` — nghi do Prisma Client hoặc HTTP
    agent chưa đóng đúng lúc test xong. Chưa điều tra sâu.
  - Mỗi lần chạy `verify-step6.sh` tạo 1 Source mới (`Application API
    (verify-step6)`) qua `POST /sources`, không dọn lại — tích rác dần
    trong DB dev. Không ảnh hưởng kết quả test, nhưng nên dọn 1 lần trước
    khi nộp bài.

## 8. Tiến độ (cập nhật thời điểm viết file này)

- ✅ **Step 1** — Skeleton: NestJS + Next.js + Docker Compose + 5 module rỗng
  + devcontainer cho Codespaces. Verify thật (`docker compose up`, `/health`
  trả đúng, log 5 module load đúng tên).
- ✅ **Step 2** — Prisma schema (9 bảng), migrate + verify constraint/FK thật
  qua `psql` trên Postgres thật.
- ✅ **Step 3** — Canonicalization pipeline (Rule 1–5b), pure function, 9
  unit test pass.
- ✅ **Step 4** — Production-domain logic (Rule 6–7), pure function, 12 unit
  test pass. Đổi tên `sourceRecordPk`.
- ✅ **Step 5** — Wire Prisma Client thật (transaction insert→recompute→
  update), integration test trên Postgres thật, **đã verify thành công**
  (10 scenario tách riêng bằng `test.each`, + idempotent + recompute-lịch-sử
  + ACK_EXCEPTION + NotFoundException, tất cả pass thật trên Docker).
  `npm run seed` chạy được.
- ✅ **Step 6** — Application API collector: `fixture-api/` (mock service
  riêng trong docker-compose), fault injection (`500-once`/`500-always`/
  `timeout`), `CollectionRunsService.runCollection()` với retry + reuse
  `ingestBatch()` từ Step 5, secret handling. **Verify THẬT xong trên
  Postgres thật** sau chuỗi debug dài (xem cạm bẫy #8–11 ở mục 5) —
  `npm run verify:step6` PASS, 22/22 test, log thật xác nhận đúng hành vi
  retry (`attempt 1/3 failed → SUCCESS`). Chi tiết đầy đủ nằm ở `README.md`
  gốc, mục "Nhật ký triển khai".
- 🔜 **Step 7** — Database collector (register/verify/discover/select/
  collect + secret handling riêng cho nguồn DB), tái sử dụng đúng
  `canonicalizationService.ingestBatch()` như Step 5–6. **Chưa soạn prompt,
  chưa bắt đầu.**
- Sau Step 7 dự kiến: Step 8 (Supplier Crawler — pagination loop
  protection), sau đó ManagementEventsModule ghi thật, rồi UI (2 màn Data
  Sources + Production Lines).

## 9. Muốn tiếp tục ngay — việc đầu tiên nên làm

1. Đọc `README.md` gốc, mục "Nhật ký triển khai", tìm entry mới nhất — xác
   nhận trạng thái có khớp với mục 8 ở trên không (nếu file này đã cũ so
   với thực tế, tin README hơn).
2. Nếu Step 6 đã xong đúng như mục 8: soạn prompt Step 7 (Database
   collector) theo cùng template ở mục 3, nhớ dặn `npm install` đầu tiên,
   tái sử dụng đúng `canonicalizationService.ingestBatch()`, và cân nhắc
   viết thêm `scripts/verify-step7.sh` theo đúng pattern đã có ở mục 7
   thay vì verify tay lại từ đầu.
3. Nếu phát sinh vấn đề migration mới ở Step 7 (thêm bảng/cột cho Database
   collector) — đọc kỹ cạm bẫy #11 ở mục 5 trước khi debug, khả năng cao
   là cùng loại vấn đề (quên `git add` migration mới).
