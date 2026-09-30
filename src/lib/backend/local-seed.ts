import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

// Dữ liệu mẫu cho chế độ local — CHỈ để test trên máy. Nạp một lần khi DB trống.
// Tài khoản (mật khẩu mặc định "123456"): admin (ADMIN), anh, binh, chi (thành viên quỹ), moi (không thuộc quỹ).

export const LOCAL_PASSWORD = "123456";

type Rpc = (claims: Record<string, unknown>, fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;

export async function seedLocal(db: PGlite, rpc: Rpc, hash: (pw: string) => string, domain: string) {
  const has = await db.query<{ n: number }>(`select count(*)::int n from public.profiles`);
  if (has.rows[0].n > 0) return;

  const users = [
    { code: "NV000", username: "admin", name: "Quản trị quỹ", role: "ADMIN", must: false },
    { code: "NV001", username: "anh", name: "Nguyễn Văn Anh", role: "MEMBER", must: false },
    { code: "NV002", username: "binh", name: "Trần Thị Bình", role: "MEMBER", must: false },
    { code: "NV003", username: "chi", name: "Lê Minh Chi", role: "MEMBER", must: false },
    { code: "NV004", username: "moi", name: "Phạm Thu Mới", role: "MEMBER", must: false },
  ];
  const ids: Record<string, string> = {};
  await db.transaction(async (tx) => {
    for (const u of users) {
      const id = randomUUID();
      ids[u.username] = id;
      await tx.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${u.username}@${domain}`]);
      await tx.query(`insert into auth.local_credentials (user_id, password_hash) values ($1, $2)`, [id, hash(LOCAL_PASSWORD)]);
      await tx.query(
        `insert into public.profiles (id, employee_code, username, display_name, role, must_change_password) values ($1, $2, $3, $4, $5, $6)`,
        [id, u.code, u.username, u.name, u.role, u.must]);
    }
  });

  const asAdmin = { sub: ids.admin, role: "authenticated" };
  const call = async (claims: Record<string, unknown>, fn: string, args: Record<string, unknown>) => {
    const r = await rpc(claims, fn, args);
    if (r.error) throw new Error(`[local-seed] ${fn}: ${r.error.message} ${r.error.details ?? ""}`);
    return r.data;
  };
  const today = (await db.query<{ d: string }>(`select private.vn_today()::text d`)).rows[0].d;
  const daysAgo = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  // Quỹ: A/B/C (+ admin) từ 14 ngày trước
  for (const u of ["admin", "anh", "binh", "chi"]) {
    await call(asAdmin, "admin_upsert_membership", { p_membership_id: null, p_user_id: ids[u], p_start_date: daysAgo(14), p_end_date: null, p_reason: "Seed local" });
  }
  for (const u of ["anh", "binh", "chi"]) {
    await call(asAdmin, "post_deposit", { p_idem_key: randomUUID(), p_user_id: ids[u], p_amount_vnd: 30000, p_occurred_on: daysAgo(10), p_external_ref: `CK-${u}` });
  }
  const lines = [
    { line_type: "ITEM", item_name: "Hạt cà phê 1kg", quantity: 1, unit: "kg", line_amount_vnd: 250000 },
    { line_type: "FEE", item_name: "Phí ship", line_amount_vnd: 15000 },
    { line_type: "DISCOUNT", item_name: "Voucher", line_amount_vnd: -15000 },
  ];
  const preview = await call(asAdmin, "preview_purchase", { p_occurred_on: daysAgo(7), p_paid_by: "MEMBER", p_payer_user_id: ids.anh, p_lines: lines });
  await call(asAdmin, "post_purchase", { p_idem_key: randomUUID(), p_occurred_on: daysAgo(7), p_paid_by: "MEMBER", p_payer_user_id: ids.anh,
    p_lines: lines, p_preview_hash: preview.preview_hash, p_shop: "Cửa hàng hạt", p_external_ref: "HD-001" });
  const gift = await call(asAdmin, "preview_gift", { p_amount_vnd: 40000, p_occurred_on: daysAgo(3) });
  await call(asAdmin, "post_gift", { p_idem_key: randomUUID(), p_amount_vnd: 40000, p_occurred_on: daysAgo(3), p_preview_hash: gift.preview_hash, p_note: "Sếp cho thêm" });

  // Đợt pha đang mở: mở 10 phút trước, chốt sau 2 giờ
  const now = Date.now();
  const s = await call(asAdmin, "admin_create_vote_session", {
    p_name: "Pha sáng", p_service_date: today,
    p_opens_at: new Date(now - 10 * 60_000).toISOString(), p_cutoff_at: new Date(now + 120 * 60_000).toISOString(),
    p_planned_brew_at: new Date(now + 135 * 60_000).toISOString(),
    p_styles: ["Phin", "Máy", "Cold brew"], p_addons: ["Sữa đặc", "Sữa tươi", "Đường", "Ít đường", "Đá"],
  });
  const opt = (kind: "styles" | "addons", label: string) => s.options[kind].find((o: any) => o.label === label).id;
  await call({ sub: ids.anh, role: "authenticated" }, "cast_vote", { p_session_id: s.id, p_choice: "YES",
    p_style_option_id: opt("styles", "Máy"), p_addon_ids: [opt("addons", "Sữa tươi"), opt("addons", "Ít đường")], p_cups: 2 });
  await call({ sub: ids.chi, role: "authenticated" }, "cast_vote", { p_session_id: s.id, p_choice: "YES",
    p_style_option_id: opt("styles", "Phin"), p_addon_ids: [opt("addons", "Sữa đặc"), opt("addons", "Đá")], p_cups: 1 });

  console.info(JSON.stringify({ level: "info", action: "local.seed", code: "OK", params: { users: users.map((u) => u.username), password: "[xem README]" } }));
}
