-- 000020: Sửa lỗi "permission denied for schema private" khi ghi sổ quỹ trên production.
-- Trigger kiểm bất biến Σmember = Σcash là trigger HOÃN (chạy lúc COMMIT). Trên Postgres < 18 (Supabase),
-- trigger hoãn chạy dưới vai trò đang đăng nhập (authenticated) — vai trò này không được dùng schema private.
-- Cho hàm trigger chạy với quyền chủ sở hữu, như các hàm api.*. Không đổi logic.

alter function private.check_event_balance_trg() security definer;
alter function private.check_event_balance(uuid) security definer;
revoke all on function private.check_event_balance_trg(), private.check_event_balance(uuid) from public, anon, authenticated;
