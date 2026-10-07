import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createDb, createUser, rpc, vnToday } from "./harness";

// Production nâng cấp tay bằng supabase/deploy/upgrade_013_016.sql: phải chạy được trên DB đang ở migration 12, chạy lại vẫn an toàn
test("upgrade_013_016.sql: DB migration 12 → 16, chạy 2 lần không lỗi, hàm mới dùng được", async () => {
  const db = await createDb({ upTo: "20260930000012_vote_options.sql" });
  const sql = readFileSync("supabase/deploy/upgrade_013_016.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  const checks = await db.query<{ ham: string; co: boolean }>(sql.slice(sql.lastIndexOf("select 'vote_templates")));
  expect(checks.rows.every((r) => r.co)).toBe(true);

  const today = await vnToday(db);
  const admin = await createUser(db, { code: "NV001", username: "admin", role: "ADMIN" });
  const a = await createUser(db, { code: "NV002", username: "anh", name: "Anh" });
  const s = await rpc(db, a.id, "create_vote_session", { p_name: "Sáng", p_service_date: today,
    p_opens_at: new Date(Date.now() - 60_000).toISOString(), p_cutoff_at: new Date(Date.now() + 3_600_000).toISOString(),
    p_styles: ["Espresso", "Latte"] });
  const r = await rpc(db, a.id, "cast_vote_for", { p_session_id: s.id, p_user_id: admin.id, p_style_option_id: s.options.styles[0].id });
  expect(r.my_proxies).toHaveLength(1);
  const u = await rpc(db, admin.id, "admin_update_vote_session", { p_session_id: s.id, p_name: "Sửa", p_service_date: today,
    p_opens_at: new Date(Date.now() - 60_000).toISOString(), p_cutoff_at: new Date(Date.now() + 7_200_000).toISOString(),
    p_allow_cups: true, p_styles: ["Espresso"], p_addons: [] });
  expect(u.name).toBe("Sửa");
  const f = await rpc(db, a.id, "fund_summary", {});
  expect(f.people).toHaveLength(2);
});

test("upgrade_017_avatar.sql: DB migration 16 → 17, chạy 2 lần không lỗi", async () => {
  const db = await createDb({ upTo: "20260930000016_everyone_shares.sql" });
  const sql = readFileSync("supabase/deploy/upgrade_017_avatar.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  const checks = await db.query<{ co: boolean }>(sql.slice(sql.lastIndexOf("select 'cột")));
  expect(checks.rows.every((r) => r.co)).toBe(true);
  const a = await createUser(db, { code: "NV001", username: "anh" });
  const r = await rpc(db, a.id, "set_my_avatar", { p_avatar: "data:image/jpeg;base64,AAAA" });
  expect(r.avatar).toBe("data:image/jpeg;base64,AAAA");
  expect((await rpc(db, a.id, "me", {})).avatar).toBe("data:image/jpeg;base64,AAAA");
});

test("upgrade_018_rbac.sql: DB migration 17 → 18, chạy 2 lần; ADMIN cũ thành Quản trị viên", async () => {
  const db = await createDb({ upTo: "20260930000017_avatar.sql" });
  const admin = await createUser(db, { code: "NV001", username: "admin", role: "ADMIN" });
  const a = await createUser(db, { code: "NV002", username: "anh" });
  const sql = readFileSync("supabase/deploy/upgrade_018_rbac.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  const checks = await db.query<{ co: boolean }>(sql.slice(sql.lastIndexOf("select 'bảng")));
  expect(checks.rows.every((r) => r.co)).toBe(true);
  const roles = await rpc(db, admin.id, "admin_list_roles");
  expect(roles).toHaveLength(1);
  expect(roles[0].users.map((u: any) => u.username)).toEqual(["admin"]);
  expect((await rpc(db, a.id, "me")).permissions).toEqual([]);

  // Đã phân vai trò hẹp rồi chạy lại file: không bị nâng lên Quản trị viên
  const r = await rpc(db, admin.id, "admin_save_role", { p_role_id: null, p_name: "Điều phối", p_description: null, p_permissions: ["votes.manage"] });
  await rpc(db, admin.id, "admin_set_user_roles", { p_user_id: a.id, p_role_ids: [r.id] });
  await db.exec(sql);
  expect((await rpc(db, a.id, "me")).permissions).toEqual(["votes.manage"]);
});

test("upgrade_019_fund_activity.sql: DB migration 18 → 19, chạy 2 lần", async () => {
  const db = await createDb({ upTo: "20260930000018_rbac.sql" });
  const sql = readFileSync("supabase/deploy/upgrade_019_fund_activity.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  const a = await createUser(db, { code: "NV001", username: "anh" });
  expect((await rpc(db, a.id, "fund_activity")).total).toBe(0);
});
