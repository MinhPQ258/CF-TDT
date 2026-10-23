import { beforeEach, describe, expect, test } from "vitest";
import { createDb, createUser, expectCode, rpc, type Db, type TestUser } from "./harness";

let db: Db;
let admin: TestUser;
let a: TestUser;
let b: TestUser;

beforeEach(async () => {
  db = await createDb();
  admin = await createUser(db, { code: "NV001", username: "admin", name: "Quản trị", role: "ADMIN" });
  a = await createUser(db, { code: "NV002", username: "anh", name: "Anh" });
  b = await createUser(db, { code: "NV003", username: "binh", name: "Bình" });
  await rpc(db, admin.id, "admin_duty_reset");
});

describe("trực nhật — vòng quay", () => {
  test("quản trị viên có quyền duty.manage; thành viên chỉ xem lịch sử, không thấy danh sách", async () => {
    expect((await rpc(db, admin.id, "me")).permissions).toContain("duty.manage");
    const s = await rpc(db, admin.id, "duty_state");
    expect(s.can_manage).toBe(true);
    expect(s.members.map((m: any) => m.name)).toEqual(["Quản trị", "Anh", "Bình"]);
    const m = await rpc(db, a.id, "duty_state");
    expect(m).toMatchObject({ can_manage: false, members: null, history: [] });
    await expectCode(rpc(db, a.id, "admin_duty_spin", { p_remove: false }), "INSUFFICIENT_PERMISSION");
    await expectCode(rpc(db, a.id, "admin_duty_add", { p_name: "X" }), "INSUFFICIENT_PERMISSION");
  });

  test("quay: người trúng thuộc danh sách, index khớp; ghi lịch sử cho mọi người xem; xoá sau khi trúng", async () => {
    const r = await rpc(db, admin.id, "admin_duty_spin", { p_remove: true });
    expect(r.members_before[r.index].id).toBe(r.winner.id);
    // xoá sau khi trúng = bỏ tích: vẫn trong danh sách, không còn trên vòng quay
    expect(r.members).toHaveLength(3);
    expect(r.members.find((x: any) => x.id === r.winner.id).active).toBe(false);
    const r2 = await rpc(db, admin.id, "admin_duty_spin", { p_remove: false });
    expect(r2.members_before).toHaveLength(2);
    expect(r2.members_before.map((x: any) => x.id)).not.toContain(r.winner.id);
    const h = await rpc(db, a.id, "duty_state");
    expect(h.total_spins).toBe(2);
    expect(h.history.map((x: any) => x.name)).toEqual([r2.winner.name, r.winner.name]);
    await rpc(db, admin.id, "admin_duty_set_active", { p_id: r2.members_before[0].id, p_active: false });
    await expectCode(rpc(db, admin.id, "admin_duty_spin", { p_remove: false }), "INVALID_INPUT"); // còn 1 người được tích
    const back = await rpc(db, admin.id, "admin_duty_set_active", { p_id: r.winner.id, p_active: true });
    expect(back.filter((x: any) => x.active)).toHaveLength(2);
    await expectCode(rpc(db, a.id, "admin_duty_set_active", { p_id: r.winner.id, p_active: false }), "INSUFFICIENT_PERMISSION");
  });

  test("thêm / sửa / xoá; không trùng tên; nạp lại = mọi tài khoản đang hoạt động", async () => {
    let list = await rpc(db, admin.id, "admin_duty_add", { p_name: "  Khách  " });
    expect(list.map((x: any) => x.name)).toEqual(["Quản trị", "Anh", "Bình", "Khách"]);
    await expectCode(rpc(db, admin.id, "admin_duty_add", { p_name: "anh" }), "DUPLICATE_REFERENCE");
    const khach = list[3].id;
    list = await rpc(db, admin.id, "admin_duty_rename", { p_id: khach, p_name: "Khách mời" });
    expect(list[3].name).toBe("Khách mời");
    await expectCode(rpc(db, admin.id, "admin_duty_rename", { p_id: khach, p_name: "Bình" }), "DUPLICATE_REFERENCE");
    list = await rpc(db, admin.id, "admin_duty_delete", { p_id: khach });
    expect(list).toHaveLength(3);
    await db.query(`update profiles set status = 'DISABLED' where id = $1`, [b.id]);
    list = await rpc(db, admin.id, "admin_duty_reset");
    expect(list.map((x: any) => x.name)).toEqual(["Quản trị", "Anh"]);
  });

  test("trùng tên hiển thị: nạp lại không bỏ sót ai, thêm mã NV để phân biệt", async () => {
    await createUser(db, { code: "NV004", username: "anh2", name: "Anh" });
    const list = await rpc(db, admin.id, "admin_duty_reset");
    expect(list.map((x: any) => x.name)).toEqual(["Quản trị", "Anh (NV002)", "Bình", "Anh (NV004)"]);
  });

  test("reset lịch sử: người trong lịch sử trở lại vòng quay (tích lại / thêm lại nếu đã xoá), lịch sử trống", async () => {
    const r1 = await rpc(db, admin.id, "admin_duty_spin", { p_remove: true }); // bỏ tích người trúng
    const r2 = await rpc(db, admin.id, "admin_duty_spin", { p_remove: true });
    await rpc(db, admin.id, "admin_duty_delete", { p_id: r2.winner.id });    // người thứ 2 bị xoá hẳn
    const res = await rpc(db, admin.id, "admin_duty_reset_history");
    expect(res).toMatchObject({ cleared: 2, returned: 2 });
    expect(res.members).toHaveLength(3);
    expect(res.members.every((m: any) => m.active)).toBe(true);
    expect(res.members.map((m: any) => m.name)).toEqual(expect.arrayContaining([r1.winner.name, r2.winner.name]));
    const s2 = await rpc(db, a.id, "duty_state");
    expect(s2).toMatchObject({ total_spins: 0, history: [] });
    await expectCode(rpc(db, a.id, "admin_duty_reset_history"), "INSUFFICIENT_PERMISSION");
    const audit = await db.query<{ action: string }>(`select action from audit_events where action = 'duty.reset_history'`);
    expect(audit.rows).toHaveLength(1);
  });

  test("vai trò tự tạo có quyền Trực nhật thì quay được", async () => {
    const role = await rpc(db, admin.id, "admin_save_role", { p_role_id: null, p_name: "Trực nhật", p_description: null, p_permissions: ["duty.manage"] });
    await rpc(db, admin.id, "admin_set_user_roles", { p_user_id: b.id, p_role_ids: [role.id] });
    const r = await rpc(db, b.id, "admin_duty_spin", { p_remove: false });
    expect(r.winner.name).toBeTruthy();
    await expectCode(rpc(db, b.id, "post_deposit", { p_idem_key: crypto.randomUUID(), p_user_id: a.id, p_amount_vnd: 1000, p_occurred_on: "2026-10-01" }), "INSUFFICIENT_PERMISSION");
  });
});
