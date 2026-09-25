-- ============================================================================
-- Tạo tài khoản ADMIN đầu tiên (chạy SAU coffee_tdt_full.sql)
--
-- Bước 1 — Dashboard → Authentication → Users → Add user → Create new user:
--    Email:    <username>@coffee.internal     (vd: minhpq@coffee.internal)
--    Password: mật khẩu tạm (≥ 8 ký tự)
--    ✔ Auto Confirm User
-- Bước 2 — sửa 3 giá trị bên dưới rồi Run trong SQL Editor.
-- Lần đăng nhập đầu app sẽ bắt đổi mật khẩu. Các tài khoản sau tạo trong app (/admin/users).
-- ============================================================================

insert into public.profiles (id, employee_code, username, display_name, role, status, must_change_password)
select u.id, 'NV001', 'minhpq', 'Phạm Quang Minh', 'ADMIN', 'ACTIVE', true
from auth.users u
where u.email = 'minhpq@coffee.internal';

-- Tùy chọn: admin cũng là thành viên quỹ từ ngày go-live (quyết định 1B: quỹ bắt đầu từ 0)
-- insert into public.fund_memberships (user_id, start_date, reason, created_by, updated_by)
-- select id, date '2026-10-01', 'Go-live', id, id from public.profiles where username = 'minhpq';

-- Kiểm tra
select id, employee_code, username, role, must_change_password from public.profiles;
