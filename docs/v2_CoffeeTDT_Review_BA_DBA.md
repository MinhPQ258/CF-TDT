# Coffee TDT — Phản biện BA/DBA v2.2 & sổ quyết định

**Ngày:** 25/09/2026 · **Người review:** MinhPQ (vai CEO review, Claude hỗ trợ) · **Chế độ:** Giữ nguyên phạm vi · **Kiến trúc:** Phương án B
**Đầu vào:** `v1_CoffeeTDT_BA_Business_Requirements.md` (v2.2), `v1_CoffeeTDT_DBA_Database_Architecture.md` (v2.2), `v1_CoffeeTDT_DEV_Plan_Web.md` (v1.0)

> Tài liệu này là **nguồn sự thật** cho các điểm dưới đây cho tới khi BA/DBA phát hành bản v2.3. Khi BA/DBA và tài liệu này mâu thuẫn, dev làm theo tài liệu này.

## 1. Nhận định chung

- **ỔN:** mô hình 2 sổ (`cash_ledger` + `member_ledger`) với bất biến `SUM(member) = SUM(cash)` là đúng và nên giữ. Ví dụ A/B/C trong BA §3 và DBA §4 đã kiểm lại bằng script: đúng (A +50.000, B/C −10.000, quỹ 30.000).
- **ỔN:** quy tắc chia `q = floor(x/N)`, `r = x mod N`, `r` người đầu +1đ là tất định và bảo toàn tổng.
- **Rủi ro chính của sản phẩm:** không phải thiếu tính năng mà là **số liệu sai một lần là mất niềm tin**. Mọi quyết định dưới đây ưu tiên tính đúng và khả năng giải thích số dư.
- **Tên dự án:** thống nhất **Coffee TDT** (tài liệu cũ ghi "Coffee 12A"). Repo gợi ý: `coffee-tdt`.

## 2. Các điểm mơ hồ và quyết định đã chốt

| # | Mức | Vấn đề (vị trí) | Quyết định | Tác động tới BA/DBA |
|---|---|---|---|---|
| 1 | LỖ HỔNG NGHIÊM TRỌNG | Không có cách ghi số dư mở sổ khi quỹ đã tồn tại (DBA §3 không có kind tương ứng; DEV §8 để mở) | **1B — Bắt đầu từ 0.** Tất toán ngoài app trước go-live; ngày go-live quỹ = 0, mọi người = 0 | BA: thêm điều kiện go-live. DEV: bỏ hạng mục "nhập số dư ban đầu" |
| 2 | LỖ HỔNG NGHIÊM TRỌNG | "± điều chỉnh" (BA §3), "điều chỉnh chưa phân bổ" (BA §5) mâu thuẫn với bất biến; "quà **mặc định** chia đều" ngụ ý có ngoại lệ | **2A — Bỏ hẳn.** Mọi sửa sai = REVERSAL + ghi lại. Quà **luôn** chia đều | BA: xóa 3 cụm từ trên. Đối soát: lệch ≠ 0 luôn là lỗi |
| 3 | LỖ HỔNG NGHIÊM TRỌNG | `occurred_at` là ngày hay giờ? Người vào quỹ trong ngày có bị chia không? Sửa ngày membership lùi quá khứ? | **3C — Theo NGÀY, cho sửa membership tự do.** `occurred_on date` (giờ VN); membership `[start_date, end_date)`: vào ngày 25 → bị chia phiếu ngày 25; rời ngày 30 → không bị chia phiếu ngày 30 | DBA: đổi `occurred_at timestamptz` → `occurred_on date`; `starts_at/ends_at` → `start_date/end_date date` |
| 3′ | CẢNH BÁO (hệ quả 3C) | Sửa membership sau khi đã post làm bảng membership không khớp phân bổ cũ | Giảm thiểu: **bắt buộc lý do + audit log** khi sửa; màn hình báo "khác với phân bổ của N phiếu đã post — phiếu cũ KHÔNG bị tính lại". Phân bổ cũ an toàn vì đã chụp vào `member_ledger` | DBA: thêm `reason`, `updated_by` cho `fund_memberships` |
| 4 | CẢNH BÁO | Thành viên rời quỹ khi số dư ≠ 0 — không có quy trình | **4A — Cảnh báo + tất toán.** Khi đóng membership hiển thị số dư, gợi ý DEPOSIT (âm) hoặc REIMBURSEMENT (dương). Cho đóng khi ≠ 0 nhưng dashboard gắn cờ "rời quỹ chưa tất toán" | BA: thêm quy trình rời quỹ |
| 5 | CẢNH BÁO | Quy trình ghi mua hộ còn mở (BA §7, DBA §7, DEV §8) | **5A — Admin tự nhập** sau khi kiểm tra hóa đơn ngoài app. Không upload, không trạng thái chờ duyệt | BA: đóng câu hỏi mở |
| 6 | CẢNH BÁO | "Xem tổng quỹ nếu được công khai" — không rõ ai quyết | **6A — Thành viên thấy tổng quỹ thực + danh sách phiếu mua** (mặt hàng, tổng, ngày, N người chia, phần của mình). **Không** thấy số dư người khác | Không cần bảng settings |
| 7 | CẢNH BÁO | Ai được vote? Kết quả hiện tên hay ẩn danh? | **7A — Mọi tài khoản ACTIVE được vote; kết quả hiện tên** + máy/phin + số cốc | DBA: không cần FK vote ↔ membership |
| 8 | CẢNH BÁO | Tổng phiếu nhập riêng hay cộng từ dòng? Giảm giá/phí ship? (`line_amount >= 0`) | **8A — Tổng = tổng các dòng, DB tự tính.** Phí ship = 1 dòng; giảm giá = dòng `line_type = DISCOUNT` số âm; tổng cuối > 0 | DBA: thêm `line_type ITEM/FEE/DISCOUNT`, cho `line_amount_vnd < 0` khi DISCOUNT; `total_amount_vnd` do hàm post tính |
| 9 | LỖ HỔNG NGHIÊM TRỌNG | `entry_type = REVERSAL` làm mất loại gốc → báo cáo "nhóm theo loại" sai; cột liên kết dòng gốc không được định nghĩa | **9A — Dòng đảo giữ entry_type gốc, số tiền ngược dấu, thêm `reverses_entry_id FK UNIQUE`.** Tương tự cash: `cash_ledger.reverses_entry_id` | DBA: bỏ giá trị `REVERSAL` khỏi `entry_type` |
| 10 | LỖ HỔNG NGHIÊM TRỌNG | Không có cột idempotency; `external_ref` NULL ở fund_events nhưng UNIQUE bắt buộc ở purchases → double-click tạo 2 phiếu | **10A — `fund_events.idempotency_key uuid UNIQUE NOT NULL`** (form sinh khi mở). `external_ref` = mã chứng từ tùy chọn, UNIQUE khi có. Import: key tất định từ `(checksum file, số dòng)` + `external_ref` bắt buộc | DBA: thêm cột, sửa `purchases.external_ref` thành NULL được |
| 11 | CẢNH BÁO | `users.password_hash` (tự làm auth) mâu thuẫn phương án B | **11A — Supabase Auth, email ảo `username@coffee.internal`**, mật khẩu tạm hiển thị 1 lần, cờ `must_change_password`. Bỏ `password_hash` khỏi `users`; `users.id = auth.users.id` | DBA: sửa bảng `users` → `profiles` |
| 12 | CẢNH BÁO | "Tổng chi kỳ" trên dashboard không rõ nghĩa | **12A — Hiện 2 số có nhãn:** "Chi phí phát sinh" (mọi phiếu mua, quỹ + mua hộ) và "Quỹ đã chi" (PURCHASE_FUND + REIMBURSEMENT) | BA §5: sửa nhãn |
| 13a | ỔN | Trạng thái vote cần cron? | **Tính theo giờ:** mở khi `now() ∈ [opens_at, cutoff_at)` và không `CANCELLED`/`closed_early_at`. Không cần cron | DBA: `status` chỉ còn `DRAFT/PUBLISHED/CANCELLED` + `closed_early_at` |
| 13b | ỔN | Ngày tương lai | **Chặn** post `occurred_on > hôm nay (giờ VN)` | — |
| 13c | Người dùng không chọn | Cấm đảo một bút toán đảo | **Không cấm.** Đảo một REVERSAL = khôi phục giao dịch gốc; vẫn giới hạn mỗi event chỉ bị đảo 1 lần | DEV phải test chuỗi gốc → đảo → đảo lại |
| 13d | Người dùng không chọn | Cảnh báo hoàn tiền vượt số dư | **Không cảnh báo.** Hoàn tiền vượt số dư làm người nhận âm — đúng quy tắc BA §3 | — |

## 3. Các điểm nhỏ khác (không cần quyết định, dev xử lý theo mặc định)

- **Làm tròn:** `r` đồng dư luôn rơi vào cùng những người có mã nhỏ. Chênh lệch tối đa `< 1đ × số phiếu` — chấp nhận, giữ quy tắc BA; màn hình giải thích như BA §3 yêu cầu.
- **Người mua hộ phải là thành viên quỹ tại ngày phiếu** (DBA §3) — giữ; hàm post trả lỗi `PAYER_NOT_MEMBER`.
- **N = 0** khi post GIFT/PURCHASE → lỗi `NO_ACTIVE_MEMBERS` (DBA §4) — giữ.
- **Admin cũng là thành viên** và có thể tự ghi tiền nộp của mình — chấp nhận cho nhóm nhỏ; mọi thao tác có `actor_user_id` và audit log để kiểm tra chéo.
- **Tổng quỹ âm trên sổ** (DBA §1) không thể xảy ra nếu chỉ post đúng; dashboard hiển thị cảnh báo đỏ nếu `SUM(cash) < 0`.

## 4. Việc BA/DBA cần làm (phát hành v2.3)

- [ ] BA: cập nhật §3 (bỏ "± điều chỉnh", quà luôn chia), §5 (nhãn dashboard, đối soát), §7 (đóng các câu hỏi mở theo #3–#7), thêm quy trình go-live từ 0 và quy trình rời quỹ.
- [ ] DBA: cập nhật §3 theo #3, #3′, #8, #9, #10, #11, #13a; bảng posting §4 cho dòng đảo giữ loại gốc.
- [ ] Chủ quỹ: chốt **danh sách thành viên + mã nhân viên + ngày bắt đầu** trước khi seed (vẫn là dữ liệu, không phải quyết định thiết kế).
