# Celesnity Factory Platform

Nền tảng thu thập và tổng hợp dữ liệu sản xuất cho Celesnity Technical
Take-Home Assessment (Software Track): kéo dữ liệu từ nhiều nguồn (API,
database, crawler), hợp nhất chúng theo domain rules, và hiển thị qua 2
màn quản lý — Data Sources và Production Lines.

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

Migration chạy tự động khi container `backend` khởi động (`npx prisma
migrate deploy`, xem `docker-compose.yml`'s `command:`) — không cần chạy
tay.

Sau khi cả 5 service `healthy` (`docker compose ps`), seed dữ liệu mẫu —
10 batch scenario + 3 Source đã cấu hình sẵn, dùng ngay được qua UI. Script
này chạy trên host chứ không phải trong container, nên cần file `.env`
riêng của backend:

```bash
cp backend/.env.example backend/.env
cd backend && npm run seed
```

- Backend: http://localhost:3001 (health check: `GET /health`)
- Frontend: http://localhost:3000
- Postgres: localhost:5433 (host port — bên trong mạng Docker vẫn là 5432)

Muốn chạy backend trực tiếp trên host, không qua Docker: xem
`backend/.env.example` (`DB_HOST=localhost`).

### GitHub Codespaces

Mở repo trong Codespaces là chạy được ngay — `.devcontainer/devcontainer.json`
attach vào service `backend`, forward sẵn port 3001/3000. Không có gì đặc
biệt phải cấu hình thêm, vẫn là `docker compose up` như bình thường.

## Kiến trúc

Backend là modular monolith NestJS, 5 module nghiệp vụ:

- **SourcesModule** — đăng ký, verify, discover schema, chọn bảng để thu
  thập cho từng loại nguồn (API/Database/Crawler). `POST /sources`, `GET
  /sources`, `GET /sources/:id`, `POST /sources/:id/verify`, `GET
  /sources/:id/discover`, `POST /sources/:id/select`.
- **CollectionRunsModule** — chạy thu thập thật cho từng loại nguồn
  (fixture API có retry/backoff, Postgres ngoài, crawler HTML có chống
  pagination loop), lưu lại lịch sử mỗi lần chạy. `POST /collection-runs`,
  `GET /collection-runs`, `GET /collection-runs/:id`.
- **CanonicalizationModule** — hợp nhất các bản ghi thô theo domain rules
  (ưu tiên nguồn, phát hiện xung đột), sinh canonical event. `GET
  /canonical-events` để xem lại kèm nguồn gốc dữ liệu (source record +
  collection run nào tạo ra nó).
- **ProductionDomainModule** — tính trạng thái từng batch (đang chạy/bị
  chặn/hoàn thành), độ mới của dữ liệu, số lượng WIP theo line/trạm. `GET
  /production-lines`.
- **ManagementEventsModule** — 4 hành động quản lý: block, resume,
  acknowledge exception, add note — ghi append-only, không có gì được
  sửa/xoá sau khi ghi. `POST /management-events/block|resume|ack-exception|note`.

## Assessment Assumptions

Đề bài không cố định mọi chi tiết kỹ thuật. Dưới đây là những chỗ phải tự
quyết định khi làm, và lý do — lý giải đầy đủ kèm bằng chứng (log, code,
test) nằm trong [`docs/DEVLOG.md`](docs/DEVLOG.md).

- **Production Database chạy trên 1 Postgres riêng** trong Docker
  Compose, không phải MySQL. Đề chỉ nói "PostgreSQL or MySQL", không ép
  công nghệ cụ thể — chọn Postgres để tái dùng driver và pattern đã có
  sẵn trong repo.
- **Route cho Management Events tự thiết kế**: `POST
  /management-events/block|resume|ack-exception|note`, body `{batchId,
  actor, note?}`. Không có REST contract nào cho phần này trong đề bài
  hay trong `docs/plan-v4.md`.
- **2 route đọc cho UI đặt tên khác gợi ý trong đề**: `GET
  /canonical-events` thay vì `/source-records` (canonical event mới thật
  sự là "normalized record" đề bài nhắc tới), và `GET /production-lines`
  trả về tất cả line trong 1 lần gọi thay vì từng line riêng — đơn giản
  hơn cho frontend.
- **"Cùng trạm" khi xét một exception đã được acknowledge hay chưa**
  được hiểu thành "cùng batch, sau thời điểm event đó được cập nhật" —
  bảng `management_events` không có cột trạm để so trực tiếp. Trong phạm
  vi dữ liệu hiện có, 2 cách hiểu này cho kết quả giống nhau.
- **Retry chỉ áp dụng cho lỗi tạm thời** — sai hoặc thiếu API key (401)
  không được retry, vì gọi lại cũng không tự sửa được.
- **Phát hiện pagination loop → collection run coi là thất bại, không
  ghi nhận bất kỳ dòng nào đã crawl được** trong lần chạy đó — nhất quán
  với cách mọi collector khác trong repo xử lý khi không chắc chắn dữ
  liệu đọc được là đầy đủ.
- **`actor` luôn lấy từ người gọi**, không dùng một giá trị mặc định cố
  định — đây là thông tin thực sự khác nhau giữa các lần thao tác, cố
  định cứng sẽ làm audit log mất hết ý nghĩa.

## Hiện tại

Đã xong toàn bộ Step 1–12 (backend + frontend) và đã verify thật trên
Docker, kể cả từ một lần `git clone` sạch — mô phỏng đúng trải nghiệm của
người chấm, không phải máy dev đã chạy quen tay nhiều lần.

Nhật ký triển khai đầy đủ — từng bug, từng quyết định, từng bằng chứng
log/curl thật — nằm trong [`docs/DEVLOG.md`](docs/DEVLOG.md). Domain
rules và data model chi tiết nằm trong [`docs/plan-v4.md`](docs/plan-v4.md).
