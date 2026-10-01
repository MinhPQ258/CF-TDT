import { beforeEach, describe, expect, test } from "vitest";
import { createDb, createUser, expectCode, rpc, uuid, vnToday, type Db, type TestUser } from "./harness";

let db: Db;
let admin: TestUser;
let a: TestUser;
let b: TestUser;
let today: string;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const role = (name: string, permissions: string[], id: string | null = null) =>
  rpc(db, admin.id, "admin_save_role", { p_role_id: id, p_name: name, p_description: null, p_permissions: permissions });
const assign = (u: TestUser, roleIds: string[]) => rpc(db, admin.id, "admin_set_user_roles", { p_user_id: u.id, p_role_ids: roleIds });
const roleOf = async (u: TestUser) => (await db.query<{ role: string }>(`select role from profiles where id = $1`, [u.id])).rows[0].role;

beforeEach(async () => {
  db = await createDb();
  today = await vnToday(db);
  admin = await createUser(db, { code: "NV001", username: "admin", role: "ADMIN" });
  a = await createUser(db, { code: "NV002", username: "anh", name: "Anh" });
  b = await createUser(db, { code: "NV003", username: "binh", name: "Bình" });
});

describe("vai trò & quyền", () => {
  test("ADMIN cũ được gán vai trò hệ thống đủ quyền; me trả permissions", async () => {
    const roles = await rpc(db, admin.id, "admin_list_roles");
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ name: "Quản trị viên", is_system: true });
    expect(roles[0].users.map((u: any) => u.username)).toEqual(["admin"]);
    expect((await rpc(db, admin.id, "me")).permissions).toHaveLength(6);
    expect((await rpc(db, a.id, "me")).permissions).toEqual([]);
  });

  test("vai trò chỉ quản lý đợt pha: làm được đợt pha, bị chặn sổ quỹ / người dùng; gỡ vai trò thì về MEMBER", async () => {
    const r = await role("Điều phối pha", ["votes.manage"]);
    await assign(a, [r.id]);
    expect(await roleOf(a)).toBe("ADMIN");
    expect((await rpc(db, a.id, "me")).permissions).toEqual(["votes.manage"]);

    const s = await rpc(db, a.id, "admin_create_vote_session", { p_name: "Sáng", p_service_date: today,
      p_opens_at: inMinutes(-5), p_cutoff_at: inMinutes(60), p_styles: ["Espresso"] });
    expect(s.name).toBe("Sáng");
    await rpc(db, a.id, "admin_list_users"); // cần cho màn chọn người: quyền quản trị nào cũng xem được
    await expectCode(rpc(db, a.id, "post_deposit", { p_idem_key: uuid(), p_user_id: b.id, p_amount_vnd: 10000, p_occurred_on: today }), "INSUFFICIENT_PERMISSION");
    await expectCode(rpc(db, a.id, "admin_list_roles"), "INSUFFICIENT_PERMISSION");
    await expectCode(rpc(db, a.id, "admin_list_audit"), "INSUFFICIENT_PERMISSION");

    await assign(a, []);
    expect(await roleOf(a)).toBe("MEMBER");
    await expectCode(rpc(db, a.id, "admin_create_vote_session", { p_name: "Chiều", p_service_date: today,
      p_opens_at: inMinutes(-5), p_cutoff_at: inMinutes(60) }), "INSUFFICIENT_PERMISSION");
  });

  test("sửa quyền của vai trò áp dụng ngay cho người trong vai trò; nhiều vai trò cộng quyền", async () => {
    const r1 = await role("Thủ quỹ", ["fund.manage"]);
    const r2 = await role("Mua đồ", ["purchases.manage"]);
    await assign(b, [r1.id, r2.id]);
    expect((await rpc(db, b.id, "me")).permissions).toEqual(["fund.manage", "purchases.manage"]);
    await rpc(db, b.id, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 10000, p_occurred_on: today });
    await role("Thủ quỹ", ["reports.view"], r1.id);
    await expectCode(rpc(db, b.id, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 10000, p_occurred_on: today }), "INSUFFICIENT_PERMISSION");
    await rpc(db, b.id, "admin_overview", { p_from: null, p_to: null });
  });

  test("vai trò hệ thống không xoá / không bớt quyền; tên trùng; quyền lạ; không được làm mất người quản trị cuối", async () => {
    const sys = (await rpc(db, admin.id, "admin_list_roles"))[0];
    await expectCode(rpc(db, admin.id, "admin_delete_role", { p_role_id: sys.id }), "INVALID_INPUT");
    await expectCode(role("Quản trị viên", ["votes.manage"], sys.id), "INVALID_INPUT");
    await expectCode(role("quản trị VIÊN", ["votes.manage"]), "DUPLICATE_REFERENCE");
    await expectCode(role("Lạ", ["root"]), "INVALID_INPUT");
    await expectCode(assign(admin, []), "INVALID_INPUT"); // admin là người duy nhất có users.manage
    const r = await role("Tạm", ["votes.manage"]);
    await assign(a, [r.id]);
    await rpc(db, admin.id, "admin_delete_role", { p_role_id: r.id });
    expect(await roleOf(a)).toBe("MEMBER");
  });
});

describe("nhật ký", () => {
  test("ghi vote (tự vote, đặt hộ, rút), đăng nhập, gán vai trò; lọc theo người", async () => {
    const s = await rpc(db, admin.id, "admin_create_vote_session", { p_name: "Sáng", p_service_date: today,
      p_opens_at: inMinutes(-5), p_cutoff_at: inMinutes(60), p_styles: ["Espresso"] });
    const style = s.options.styles[0].id;
    await rpc(db, a.id, "cast_vote", { p_session_id: s.id, p_choice: "YES", p_style_option_id: style });
    await rpc(db, a.id, "cast_vote_for", { p_session_id: s.id, p_user_id: b.id, p_style_option_id: style, p_cups: 2 });
    await rpc(db, a.id, "withdraw_vote", { p_session_id: s.id });
    await rpc(db, a.id, "log_login");
    const r = await role("Điều phối", ["votes.manage"]);
    await assign(b, [r.id]);

    const mine = await rpc(db, admin.id, "admin_list_audit", { p_actor: a.id });
    expect(mine.rows.map((x: any) => x.action)).toEqual(["auth.login", "vote.withdraw", "vote.cast_for", "vote.cast"]);
    const forB = mine.rows.find((x: any) => x.action === "vote.cast_for");
    expect(forB.after).toMatchObject({ session: "Sáng", for: "Bình", style: "Espresso", cups: 2 });
    expect(forB.actor.username).toBe("anh");

    await rpc(db, admin.id, "post_deposit", { p_idem_key: uuid(), p_user_id: b.id, p_amount_vnd: 50000, p_occurred_on: today });
    const dep = await rpc(db, admin.id, "admin_list_audit", { p_action: "fund." });
    expect(dep.rows[0]).toMatchObject({ action: "fund.deposit", subject: "Bình", after: { amount_vnd: 50000 } });

    const all = await rpc(db, admin.id, "admin_list_audit", { p_action: "user.roles" });
    expect(all.total).toBe(1);
    expect(all.rows[0]).toMatchObject({ target: { username: "binh" }, after: { roles: ["Điều phối"] } });
  });
});
