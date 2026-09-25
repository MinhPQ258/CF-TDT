# Coffee 12A — Mô tả nghiệp vụ (BA)

**Phiên bản:** 2.2 · **Ngày:** 24/09/2026 · **Trạng thái:** Đã chốt quy tắc chia đều cho toàn bộ thành viên quỹ

## 1. Mục tiêu và phạm vi

Ứng dụng nội bộ để tạo vote pha cà phê chung, ghi mua đồ và tự động tính **mỗi người cần nộp thêm bao nhiêu tiền** dựa trên chi phí thực. Quỹ có tiền thành viên nộp và khoản được cho thêm. Nếu một thành viên tự bỏ tiền mua đồ chung, app ghi nhận để **giảm khoản người đó cần nộp**. Không đăng ký: quản trị cấp sẵn tài khoản.

Bản đầu gồm: tài khoản; danh sách người tham gia quỹ; vote; ghi tiền nộp; ghi tiền được cho thêm; ghi mua đồ do quỹ trả hoặc cá nhân trả; tự chia chi phí; số dư theo người/quỹ; thống kê và nhập/xuất Excel. Chưa có giá từng cốc, công thức, tồn kho, ghi pha lẻ, blog hay thanh toán tự động. **Vote không làm phát sinh tiền; chỉ giao dịch mua thực tế mới chia chi phí.**

## 2. Vai trò và thành viên tham gia quỹ

| Vai trò | Quyền |
|---|---|
| Thành viên | Vote/sửa/rút phiếu trước giờ chốt; xem kết quả; xem số dư và lịch sử phân bổ của mình; xem tổng quỹ nếu được công khai. |
| Quản trị | Cấp/khóa tài khoản; chọn người tham gia quỹ; tạo/chốt vote; ghi tiền nộp, tiền cho thêm, phiếu mua; xem/chỉnh sai bằng bút toán đối ứng; nhập/xuất Excel, đối soát. |

Một người có thể đăng nhập nhưng không tham gia chia chi phí. Mỗi thành viên quỹ có ngày bắt đầu/kết thúc tham gia. Khi ghi một phiếu mua, hệ thống **chụp danh sách người tham gia quỹ tại thời điểm chi phí phát sinh**. **Chia đều cho tất cả thành viên trong danh sách này, kể cả người không vote hoặc không uống hôm đó.** Việc thêm/bớt người sau đó không làm đổi phân bổ cũ. Quản trị cũng được tính phần chia nếu được đánh dấu là thành viên quỹ.

## 3. Quy tắc tiền và ví dụ

**Số dư của một người = tiền mặt đã nộp + giá trị đồ chung người đó tự trả + phần tiền được cho thêm được chia cho người đó − phần chi phí mua đồ được phân bổ cho người đó − tiền quỹ hoàn lại cho người đó ± điều chỉnh.**

- **Âm:** người đó còn cần nộp `abs(số dư âm)` để cân đối phần chi phí. **Dương:** đã ứng trước/nộp dư. Không chặn số âm; màn hình nêu rõ số cần nộp thêm. Không tự động thu tiền khi vote.
- **Tiền nộp quỹ:** quản trị chỉ ghi sau khi quỹ thực nhận; tăng cả tiền quỹ thực và số dư của người nộp. Nếu ghi sai, dùng giao dịch đối ứng có lý do.
- **Quỹ mua đồ:** quản trị nhập phiếu với các mặt hàng, tổng tiền, ngày, người trả `QUỸ`. Tiền quỹ thực giảm theo tổng phiếu; đồng thời tổng chi phí được chia đều cho những người tham gia ở thời điểm mua, làm giảm số dư từng người.
- **Cá nhân mua đồ chung:** nhập người mua và chọn nguồn trả `CÁ NHÂN`; quỹ thực **không giảm** vì chưa trả tiền cho cửa hàng. Tổng phiếu vẫn chia đều cho các thành viên; đồng thời ghi có **toàn bộ tổng phiếu** vào số dư người mua. Người mua cũng chịu phần chia của mình. Không ghi thêm một khoản “tiền nộp mặt” cho phiếu này.
- **Tiền được cho thêm:** tiền thực nhận làm tăng tiền quỹ; mặc định chia đều lợi ích cho các thành viên đang tham gia tại ngày nhận, tăng số dư từng người. Quà tặng không được tính là tiền riêng người nhận nộp.
- **Hoàn tiền cho thành viên mua hộ/nộp dư:** nếu quỹ trả lại tiền thực, quỹ giảm và số dư người nhận giảm cùng số tiền. Không phân bổ lại chi phí phiếu mua.

**Ví dụ ba người A, B, C:** mỗi người nộp 30.000đ → quỹ 90.000đ, mỗi người dư +30.000đ. Quỹ mua đồ 90.000đ → chia 30.000đ/người, quỹ còn 0, mỗi người còn 0. A tự mua thêm đồ chung 60.000đ → chia 20.000đ/người, A được ghi có 60.000đ: A +40.000đ; B và C mỗi người −20.000đ. Tổng số dư cá nhân vẫn bằng tiền quỹ 0. Nếu quỹ được cho thêm 30.000đ, mỗi người được +10.000đ: A +50.000đ; B/C −10.000đ; quỹ 30.000đ.

**Làm tròn VND:** chia nguyên đồng; phần dư 1–(N−1) đồng phân bổ lần lượt theo thứ tự mã thành viên cố định. Tổng các phần phải đúng bằng số tiền phiếu/quà. Trên màn hình giải thích quy tắc làm tròn.

## 4. Vote pha cà phê chung

Quản trị mở đợt với tên, ngày, giờ mở/chốt và giờ pha dự kiến. Một người một phiếu/đợt; chọn tham gia/không, nếu tham gia chọn máy/phin/chưa chọn, số cốc dự kiến và ghi chú. Được sửa/rút trước giờ chốt. Kết quả: số người, tổng cốc dự kiến và nhóm máy/phin. Một ngày có thể có nhiều đợt, kể cả vote pha thêm giữa giờ. Đợt đã chốt không nhận phiếu mới. **Vote là ý định uống và không tạo phần chi phí**; chỉ phiếu mua đồ thật mới ảnh hưởng số dư.

## 5. Giao diện quản trị và Excel

- **Dashboard:** tiền quỹ thực còn, tổng chi kỳ, tiền nộp, tiền được cho thêm, số người còn phải nộp, tổng số tiền cần nộp; danh sách từng người với số dư dương/âm và chi tiết cách tính.
- **Phiếu mua:** chọn `QUỸ` hoặc `CÁ NHÂN` và người mua (nếu cá nhân), nhập nhiều mặt hàng và tổng tiền; xem trước **ai được phân bổ bao nhiêu và số dư sau khi lưu**. Chỉ phiếu đã thanh toán mới được ghi.
- **Đối soát:** tiền quỹ thực phải bằng tổng số dư thành viên nếu đã phân bổ mọi khoản thu/chi và không có điều chỉnh chưa phân bổ. Nếu lệch, báo lỗi kiểm tra giao dịch, không tự “chữa” số liệu.
- **Nhập Excel:** tài khoản/thành viên tham gia, tiền nộp, tiền cho thêm, phiếu mua nhiều dòng mặt hàng. Hiển thị preview phân bổ và lỗi từng dòng; import một lần toàn bộ hoặc rollback; chống nhập trùng mã phiếu/giao dịch. Không nhập mật khẩu rõ.
- **Xuất Excel:** `Tong_quan`, `So_du_theo_nguoi`, `Tien_nop`, `Tien_cho_them`, `Mua_do_va_phan_bo`, `Vote`. Theo kỳ hiển thị số dư đầu, biến động và cuối; phần chi phí phân bổ và mua hộ hiện riêng. Chỉ quản trị xem/xuất dữ liệu mọi thành viên.

## 6. Tiêu chí nghiệm thu

| Mã | Kết quả |
|---|---|
| BR-01 | Chi phí một phiếu được chia chính xác cho danh sách thành viên tại ngày phiếu; đổi danh sách sau đó không đổi phiếu cũ. |
| BR-02 | Quỹ trả phiếu: quỹ giảm tổng phiếu, mỗi người giảm phần chia; không ai được ghi có mua hộ. |
| BR-03 | Cá nhân trả phiếu: quỹ không giảm, người mua được ghi có toàn bộ và cũng chịu phần chia; các thành viên khác giảm phần chia. |
| BR-04 | Tiền nộp tăng quỹ và số dư người nộp; tiền cho thêm tăng quỹ và được chia lợi ích đúng tổng tiền. |
| BR-05 | Số dư người có thể âm; hiển thị số cần nộp thêm. Hoàn tiền giảm quỹ và số dư người nhận, không chia lại phiếu cũ. |
| BR-06 | Tổng phần chia chi phí/quà bằng đúng tổng tiền kể cả trường hợp chia dư 1 đồng; sau mỗi giao dịch, tổng số dư người bằng quỹ thực. |
| BR-07 | Vote không đổi số dư/quỹ; nhiều đợt trong ngày, mỗi người sửa/rút trước chốt. |
| BR-08 | Import trùng không tạo bút toán trùng, lỗi không ghi một phần; sửa sai có đối ứng và lịch sử. |
| BR-09 | Thành viên không vote hoặc vote không uống vẫn được chia phần chi phí mua đồ và phần tiền được cho thêm như các thành viên quỹ khác. |

## 7. Quyết định cần xác nhận

**Đã chốt:** chia đều chi phí và tiền được cho thêm cho tất cả thành viên quỹ tại thời điểm giao dịch, kể cả người không uống; mua đồ không gắn với kết quả vote. Còn cần chốt ngày hiệu lực tham gia/rời quỹ, có cho thành viên tự gửi chứng từ mua hộ chờ admin duyệt không, và cách xác nhận giá trị mua hộ.
