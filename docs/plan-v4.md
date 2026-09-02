# Celesnity Technical Assessment Plan — v4 (patch trên v3)

Tài liệu này chỉ ghi phần **thay đổi so với v3**. Kiến trúc tổng thể, data model, REST contract khung, timeline tổng thể của v3 vẫn giữ nguyên — xem `celesnity-assessment-plan-v3.md`.

---

## 1. Changelog

| # | Vấn đề | Nguồn phát hiện | Sửa |
|---|---|---|---|
| 1 | `ACK_EXCEPTION` bị hiểu nhầm là có thể đổi canonical status | Review vòng 3 | Rule 5 v2.2: ACK_EXCEPTION chỉ đổi trạng thái acknowledged của quality indicator, không đụng vào `canonical_event.status` |
| 2 | `source_record_id` dùng lẫn 2 nghĩa (business ID vs internal PK) | Review vòng 3 | Đổi tên cột: `canonical_event_sources.source_record_pk → source_records.id` |
| 3 | Overclaim "conflict chỉ khả thi ở DISPATCH" | Review vòng 3 | Viết lại thành: đây là lựa chọn phạm vi của mình, không phải ràng buộc của đề |
| 4 | **Rule 4 tier tự mâu thuẫn với B006** — DB và API khác tier nên B006 sẽ luôn resolve ACCEPTED, không bao giờ CONFLICT | Tự phát hiện khi sửa #3 | Gộp Production DB + Application API vào cùng Tier 1; Crawler xuống Tier 2 riêng |

---

## 2. Domain Rules v2.2 (bản đầy đủ, thay thế v2.1)

**Rule 1 — Source observation identity**
`sourceId + sourceRecordId` (business identifier từ nguồn ngoài). Dùng để hiển thị/audit "quan sát này đến từ đâu", **không dùng để chặn insert** — mọi lần đọc đều tạo 1 row `source_records` mới (append-only tuyệt đối). Không expose `UPDATE`/`DELETE` cho entity này ở tầng repository/service.

**Rule 2 — Operational/station identity (assumption tường minh)**
`batchId + station`. *Assumption: a batch has at most one canonical station-output state per station at any point in time. New source records under the same key from the same source represent an update/correction to that state (last-observed-wins theo platform `receivedAt`, tie-break theo `source_records.id ASC` nếu `receivedAt` trùng nhau), không phải sự kiện độc lập. Progressive/incremental multi-reading-per-station từ 1 nguồn nằm ngoài phạm vi bài này.*

**Rule 3 — Quantity semantics**
`quantity` là cumulative station output. `completedQuantity` = giá trị của canonical_event đang `ACCEPTED` tại `batchId+station`.

**Rule 4 — Source priority (2 tier, đã sửa)**
- **Tier 1 (ngang hàng)**: Production Database, Application API. Lý do: đề mô tả cả hai là nguồn hợp lệ ngang nhau cho DISPATCH ("Application API or production database"), nên xếp cùng cấp độ tin cậy là hợp lý.
- **Tier 2**: Supplier Crawler.

*Phạm vi thiết kế (không phải ràng buộc của đề): trong implementation này, RECEIVING/SORTING/WASHING/DRYING/FOLDING được mô hình hoá là single-source canonical path (theo bảng mapping bắt buộc của đề). Dữ liệu "receiving records" có trong Application API fixture được dùng để liên kết work order/batch, không được đưa vào canonicalization pipeline của RECEIVING — đây là lựa chọn phạm vi để giữ complexity hợp lý trong 4 ngày, không phải điều đề bắt buộc. Do đó cross-source conflict trong implementation này chủ yếu xảy ra ở DISPATCH, nơi đề chỉ định rõ 2 nguồn hợp lệ.*

**Rule 5 — Conflict resolution (normalize → group → resolve)**
1. Group source_records theo `batchId+station` (Rule 2).
2. Cùng 1 nguồn → last-observed-wins theo `receivedAt` (tie-break `id ASC`) → `ACCEPTED`.
3. Khác tier → nguồn tier cao hơn thắng → `ACCEPTED`; các quan sát tier thấp hơn map `relationship = DUPLICATE` (giá trị khớp) hoặc `SUPERSEDED` (giá trị khác nhưng bị ghi đè).
4. Cùng tier, giá trị **khác nhau** (disagree) → `CONFLICT`. Canonical_event vẫn được tạo (batch vẫn "đạt tới" trạm đó) nhưng status = CONFLICT.
5. Cùng tier, giá trị **giống nhau** (corroborate) → không phải conflict, → `ACCEPTED`, 1 làm PRIMARY, còn lại DUPLICATE.
6. Raw `source_records` không bao giờ bị sửa/xoá.

**Rule 5b — Quality indicators & management actions (mới, tách rõ khỏi Rule 5)**
- `CONFLICT` sinh ra quality indicator (ví dụ `DISPATCH_CONFLICT`) với trạng thái `acknowledged: boolean`.
- `ACK_EXCEPTION` **chỉ** đổi `acknowledged: false → true` trên quality indicator. **Không** đổi `canonical_event.status`.
- `canonical_event.status` chỉ chuyển từ `CONFLICT` sang `ACCEPTED` khi Rule 5 tính toán lại và có đủ dữ liệu để resolve deterministic (ví dụ nguồn gửi lại giá trị hội tụ) — không có cơ chế "resolve thủ công" nào khác. Đây là quyết định có chủ đích: hệ thống không tự ý (và người dùng cũng không thể ép) biến dữ liệu mâu thuẫn thành dữ liệu đáng tin — đúng tinh thần "quan sát & audit, không tự quyết định."

**Rule 6 — Current station**
Trạm xa nhất (theo thứ tự 6 bước) có canonical_event `ACCEPTED` hoặc `CONFLICT` (batch đã "đạt tới" trạm đó dù giá trị đang tranh chấp). Late event không kéo lùi current station. Missing-data indicators derived từ canonical state hiện tại — có thể biến mất khi 1 late event trước đó được accepted.

**Rule 7 — Batch state**
COMPLETED (accepted DISPATCH) → BLOCKED (block chưa resume) → IN_PROGRESS (≥1 event ACCEPTED/CONFLICT từ RECEIVING→FOLDING) → PLANNED.

---

## 3. Fixture — cập nhật B005, B006

| Batch | Scenario | Rule | Kết quả |
|---|---|---|---|
| B005A | 2 source_records cùng `sourceId+sourceRecordId`, cùng payload, đọc lại ở run khác | Rule 1, 5.2 | Test raw-level re-read: 1 canonical_event, source dư đánh dấu DUPLICATE |
| B005B | Cùng nguồn, `sourceRecordId` **khác nhau**, nhưng cùng batch+station+giá trị | Rule 2, 5.2/5.5 | Test business-level dedup: gộp theo `batchId+station` dù raw ID khác nhau |
| B006 | DISPATCH: Application API và Production DB (cùng Tier 1) báo giá trị khác nhau, cùng thời điểm | Rule 4, 5.4 | `CONFLICT` thật — không tự resolve; `ACK_EXCEPTION` chỉ đánh dấu acknowledged, batch không COMPLETED |

Các batch B001–B004, B007–B008 giữ nguyên như v3 (không bị ảnh hưởng bởi các sửa đổi trên).

---

## 4. Schema fix

```text
canonical_event_sources
    canonical_event_id
    source_record_pk    → FK tới source_records.id (internal PK)
    relationship         PRIMARY | DUPLICATE | SUPERSEDED | CONFLICT
```
API response vẫn expose `sourceId`, `sourceRecordId` (business identifier), `collectionRunId` — không lộ `source_record_pk` ra ngoài, đây là internal join key.

Recompute canonical state khi có source_record mới nên chạy trong 1 transaction: `INSERT source_record → recompute canonical_event → update canonical_event_sources` cùng lúc, tránh UI đọc phải trạng thái nửa vời.

---

## 5. Contract — quality indicator object

```json
"qualityIndicators": [
  { "code": "DISPATCH_CONFLICT", "acknowledged": false }
]
```
thay vì chỉ string — frontend phân biệt được "có exception" vs "đã acknowledge" mà không cần tự suy luận từ management event history.

---

## 6. Test bổ sung

- `500 once → collection run SUCCESS (sau retry)`; `500 always → collection run FAILED, error recorded, app vẫn dùng được`.
- Secret regression: `POST /sources`, `GET /sources/:id`, `GET /collection-runs/:id`, application logs — assert secret không xuất hiện ở bất kỳ output nào.
- Tie-break test: 2 source_records cùng tier, cùng `receivedAt` → kết quả chọn theo `id ASC`, deterministic qua nhiều lần chạy.

---

## 7. Timeline — 1 điều chỉnh nhỏ

Tạo README skeleton ngay Day 1 (`assumptions / architecture / domain rules / running locally`), cập nhật dần qua các ngày thay vì viết dồn Day 4. README nên có section riêng **"Assessment Assumptions"** liệt kê rõ assumption ở Rule 2 và phạm vi thiết kế ở Rule 4, để reviewer không phải tự suy ra.

---

*v4 — patch trên v3. Domain Rules v2.2 ở mục 2 là bản dùng để code, thay thế v2.1.*
