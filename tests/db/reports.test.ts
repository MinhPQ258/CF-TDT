import { beforeEach, describe, expect, test } from "vitest";
import {
  addDays, createDb, createUser, expectCode, rpc, rpcService, uuid, vnToday, type Db, type TestUser,
} from "./harness";

let db: Db;
let admin: TestUser;
let a: TestUser;
let b: TestUser;
let today: string;

async function purchase(amount: number, paidBy: "FUND" | "MEMBER", payer: TestUser | null, on = today) {
  const lines = [{ item_name: "x", line_amount_vnd: amount }];
  const p = await rpc(db, admin.id, "preview_purchase", { p_occurred_on: on, p_paid_by: paidBy, p_payer_user_id: payer?.id ?? null, p_lines: lines });
  return rpc(db, admin.id, "post_purchase", { p_idem_key: uuid(), p_occurred_on: on, p_paid_by: paidBy,
    p_payer_user_id: payer?.id ?? null, p_lines: lines, p_preview_hash: p.preview_hash });
}

beforeEach(async () => {
  db = await createDb();
  today = await vnToday(db);
  // Mọi tài khoản ACTIVE (kể cả admin) đều được chia → admin chính là a; quỹ có 2 người a, b.
  admin = await createUser(db, { code: "A001", username: "anh", role: "ADMIN" });
  a = admin;
  b = await createUser(db, { code: "B002", username: "binh" });
});

describe("dashboard (12A)", () => {
  test("chi phí phát sinh ≠ quỹ đã chi; số người/tổng cần nộp", async () => {
    await rpc(db, admin.id, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 50_000, p_occurred_on: today });
    await purchase(20_000, "FUND", null);
    await purchase(10_000, "MEMBER", b);
    await rpc(db, admin.id, "post_reimbursement", { p_idem_key: uuid(), p_user_id: b.id, p_amount_vnd: 5_000, p_occurred_on: today });
    const ov = await rpc(db, admin.id, "admin_overview", { p_from: addDays(today, -1), p_to: today });
    expect(ov.costs_incurred_vnd).toBe(30_000);  // mọi phiếu, quỹ + mua hộ
    expect(ov.fund_spent_vnd).toBe(25_000);      // PURCHASE_FUND + REIMBURSEMENT
    expect(ov.deposits_vnd).toBe(50_000);
    expect(ov.cash_balance_vnd).toBe(25_000);
    expect(ov.invariant.diff_vnd).toBe(0);
    // a: 50000 −10000 −5000 = 35000; b: −10000 +10000 −5000 −5000 = −10000
    expect(ov.owing).toEqual({ people: 1, total_vnd: 10_000 });
  });

  test("tài khoản bị khóa chưa tất toán được gắn cờ", async () => {
    await purchase(10_000, "FUND", null, addDays(today, -2));
    await rpc(db, admin.id, "admin_set_user_status", { p_user_id: b.id, p_status: "DISABLED", p_reason: "chuyển phòng" });
    const ov = await rpc(db, admin.id, "admin_overview", {});
    expect(ov.left_unsettled).toEqual([expect.objectContaining({ user_id: b.id, balance_vnd: -5_000 })]);
    const rows = await rpc(db, admin.id, "admin_member_balances", {});
    expect(rows.find((r: any) => r.user_id === b.id)).toMatchObject({ left_unsettled: true, is_member_today: false });
  });

  test("số dư đầu/cuối kỳ theo người", async () => {
    await rpc(db, admin.id, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 10_000, p_occurred_on: addDays(today, -10) });
    await rpc(db, admin.id, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 5_000, p_occurred_on: today });
    const rows = await rpc(db, admin.id, "admin_member_balances", { p_from: addDays(today, -5), p_to: today });
    expect(rows.find((r: any) => r.user_id === a.id)).toMatchObject({ opening_vnd: 10_000, closing_vnd: 15_000,
      movement: expect.objectContaining({ DEPOSIT_CREDIT: 5_000 }) });
  });
});

describe("đối soát & xuất", () => {
  test("cron (service_role) chạy reconcile, member bị từ chối", async () => {
    await purchase(9_000, "FUND", null);
    const r = await rpcService(db, "reconcile", { p_source: "cron" });
    expect(r).toMatchObject({ ok: false, diff: 0, source: "cron" }); // quỹ âm → cảnh báo
    const alerts = await db.query(`select * from audit_events where action = 'reconcile.alert'`);
    expect(alerts.rows).toHaveLength(1);
    await expectCode(rpc(db, b.id, "reconcile", {}), "INSUFFICIENT_PERMISSION");
    const h = await rpc(db, admin.id, "admin_health");
    expect(h.cash_negative).toBe(true);
    expect(h.last_runs).toHaveLength(1);
  });

  test("dữ liệu xuất 6 sheet khớp DB; giới hạn 12 tháng", async () => {
    await rpc(db, admin.id, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 20_000, p_occurred_on: today });
    await purchase(8_000, "MEMBER", a);
    const x = await rpc(db, admin.id, "admin_export_data", { p_from: addDays(today, -30), p_to: today });
    expect(Object.keys(x).sort()).toEqual(["deposits", "gifts", "members", "overview", "period", "purchase_lines", "purchases", "votes"]);
    expect(x.deposits).toHaveLength(1);
    expect(x.purchases).toHaveLength(3); // 2 phần chia + 1 ghi có mua hộ
    const total = x.members.reduce((s: number, m: any) => s + m.closing_vnd, 0);
    expect(total).toBe(x.overview.cash_closing_vnd);
    await expectCode(rpc(db, admin.id, "admin_export_data", { p_from: addDays(today, -400), p_to: today }), "INVALID_INPUT");
  });
});
