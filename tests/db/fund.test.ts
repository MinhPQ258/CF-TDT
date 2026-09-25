import { beforeEach, describe, expect, test } from "vitest";
import {
  addDays, addMembership, asRole, balanceOf, balances, createDb, createUser, expectCode, rpc, uuid, vnToday,
  type Db, type TestUser,
} from "./harness";

let db: Db;
let admin: TestUser;
let a: TestUser;
let b: TestUser;
let c: TestUser;
let today: string;

async function giftPreview(amount: number, on: string) {
  return rpc(db, admin.id, "preview_gift", { p_amount_vnd: amount, p_occurred_on: on });
}

async function gift(amount: number, on: string, extra: Record<string, unknown> = {}) {
  const p = await giftPreview(amount, on);
  return rpc(db, admin.id, "post_gift", {
    p_idem_key: uuid(), p_amount_vnd: amount, p_occurred_on: on, p_preview_hash: p.preview_hash, ...extra,
  });
}

async function deposit(user: TestUser, amount: number, on = today, key = uuid()) {
  return rpc(db, admin.id, "post_deposit", { p_idem_key: key, p_user_id: user.id, p_amount_vnd: amount, p_occurred_on: on });
}

async function purchase(
  lines: object[], opts: { on?: string; paidBy?: "FUND" | "MEMBER"; payer?: TestUser; key?: string; ref?: string } = {},
) {
  const on = opts.on ?? today;
  const paidBy = opts.paidBy ?? "FUND";
  const preview = await rpc(db, admin.id, "preview_purchase", {
    p_occurred_on: on, p_paid_by: paidBy, p_payer_user_id: opts.payer?.id ?? null, p_lines: lines,
  });
  const result = await rpc(db, admin.id, "post_purchase", {
    p_idem_key: opts.key ?? uuid(), p_occurred_on: on, p_paid_by: paidBy, p_payer_user_id: opts.payer?.id ?? null,
    p_lines: lines, p_preview_hash: preview.preview_hash, p_external_ref: opts.ref ?? null,
  });
  return { preview, result };
}

async function assertInvariant() {
  const s = await balances(db);
  expect(s.member).toBe(s.cash);
}

beforeEach(async () => {
  db = await createDb();
  today = await vnToday(db);
  // employee_code quyết định thứ tự nhận +1đ: A < B < C < Z(admin, không phải thành viên quỹ)
  admin = await createUser(db, { code: "Z900", username: "admin", role: "ADMIN" });
  a = await createUser(db, { code: "A001", username: "anh" });
  b = await createUser(db, { code: "B002", username: "binh" });
  c = await createUser(db, { code: "C003", username: "chi" });
  const start = addDays(today, -30);
  for (const u of [a, b, c]) await addMembership(db, u.id, start);
});

describe("chia đều", () => {
  test("100đ / 3 người → 34/33/33, người mã nhỏ nhận +1đ", async () => {
    const p = await giftPreview(100, today);
    expect(p.split).toEqual({ n: 3, base_share_vnd: 33, remainder: 1 });
    expect(p.members.map((m: any) => [m.employee_code, m.share_vnd, m.gets_extra_one])).toEqual([
      ["A001", 34, true], ["B002", 33, false], ["C003", 33, false],
    ]);
    await gift(100, today);
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id), await balanceOf(db, c.id)]).toEqual([34, 33, 33]);
    await assertInvariant();
  });

  test("phiếu mua 100đ quỹ trả: −34/−33/−33, quỹ −100", async () => {
    await purchase([{ line_type: "ITEM", item_name: "Cà phê", line_amount_vnd: 100 }]);
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id), await balanceOf(db, c.id)]).toEqual([-34, -33, -33]);
    expect((await balances(db)).cash).toBe(-100);
    await assertInvariant();
  });

  test("tổng nhỏ hơn N: người phần 0 không có dòng ledger, tổng vẫn đúng", async () => {
    await gift(2, today);
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id), await balanceOf(db, c.id)]).toEqual([1, 1, 0]);
    await assertInvariant();
  });
});

describe("ví dụ A/B/C (BA §3)", () => {
  test("nộp 30k mỗi người → quỹ mua 90k → A mua hộ 60k → quà 30k", async () => {
    for (const u of [a, b, c]) await deposit(u, 30_000);
    expect((await balances(db)).cash).toBe(90_000);

    await purchase([{ line_type: "ITEM", item_name: "Hạt cà phê", line_amount_vnd: 90_000 }]);
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id), await balanceOf(db, c.id)]).toEqual([0, 0, 0]);
    expect((await balances(db)).cash).toBe(0);

    const { preview } = await purchase([{ line_type: "ITEM", item_name: "Sữa", line_amount_vnd: 60_000 }],
      { paidBy: "MEMBER", payer: a });
    const pa = preview.members.find((m: any) => m.user_id === a.id);
    expect(pa).toMatchObject({ share_vnd: -20_000, credit_vnd: 60_000, balance_after_vnd: 40_000 });
    expect(preview.fund_cash_change_vnd).toBe(0);
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id), await balanceOf(db, c.id)]).toEqual([40_000, -20_000, -20_000]);
    expect((await balances(db)).cash).toBe(0);

    await gift(30_000, today);
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id), await balanceOf(db, c.id)]).toEqual([50_000, -10_000, -10_000]);
    expect((await balances(db)).cash).toBe(30_000);
    await assertInvariant();
  });

  test("hoàn tiền: quỹ và số dư người nhận cùng giảm, không chia lại", async () => {
    await deposit(a, 50_000);
    await rpc(db, admin.id, "post_reimbursement", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 20_000, p_occurred_on: today });
    expect(await balanceOf(db, a.id)).toBe(30_000);
    expect(await balanceOf(db, b.id)).toBe(0);
    expect((await balances(db)).cash).toBe(30_000);
    await assertInvariant();
  });

  test("hoàn tiền vượt số dư → người nhận âm (quyết định 13d, không cảnh báo)", async () => {
    await rpc(db, admin.id, "post_reimbursement", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 5_000, p_occurred_on: today });
    expect(await balanceOf(db, a.id)).toBe(-5_000);
    await assertInvariant();
  });
});

describe("phiếu mua ITEM/FEE/DISCOUNT", () => {
  test("tổng = Σ dòng (DB tự tính), giảm giá âm", async () => {
    const lines = [
      { line_type: "ITEM", item_name: "Hạt", quantity: 1, unit: "kg", line_amount_vnd: 250_000 },
      { line_type: "FEE", item_name: "Ship", line_amount_vnd: 20_000 },
      { line_type: "DISCOUNT", item_name: "Voucher", line_amount_vnd: -30_000 },
    ];
    const { preview, result } = await purchase(lines);
    expect(preview.total_vnd).toBe(240_000);
    const detail = await rpc(db, a.id, "purchase_detail", { p_purchase_id: result.purchase_id });
    expect(detail.total_vnd).toBe(240_000);
    expect(detail.lines).toHaveLength(3);
    expect(detail.my_share_vnd).toBe(-80_000);
    expect(detail.allocations).toBeUndefined(); // thành viên không thấy bảng phân bổ người khác
    await assertInvariant();
  });

  test("giảm giá dương / tổng ≤ 0 / không có dòng → INVALID_INPUT", async () => {
    const pp = (lines: object[]) => rpc(db, admin.id, "preview_purchase", {
      p_occurred_on: today, p_paid_by: "FUND", p_payer_user_id: null, p_lines: lines });
    await expectCode(pp([{ line_type: "DISCOUNT", item_name: "x", line_amount_vnd: 10 }]), "INVALID_INPUT");
    await expectCode(pp([{ line_type: "ITEM", item_name: "x", line_amount_vnd: 10 }, { line_type: "DISCOUNT", item_name: "y", line_amount_vnd: -10 }]), "INVALID_INPUT");
    await expectCode(pp([]), "INVALID_INPUT");
    await expectCode(pp([{ line_type: "ITEM", item_name: "x", line_amount_vnd: 10.5 }]), "INVALID_INPUT");
  });

  test("người mua hộ không phải thành viên → PAYER_NOT_MEMBER", async () => {
    await expectCode(rpc(db, admin.id, "preview_purchase", {
      p_occurred_on: today, p_paid_by: "MEMBER", p_payer_user_id: admin.id,
      p_lines: [{ item_name: "x", line_amount_vnd: 1000 }] }), "PAYER_NOT_MEMBER");
  });

  test("không có thành viên → NO_ACTIVE_MEMBERS", async () => {
    await expectCode(rpc(db, admin.id, "preview_purchase", {
      p_occurred_on: addDays(today, -60), p_paid_by: "FUND", p_payer_user_id: null,
      p_lines: [{ item_name: "x", line_amount_vnd: 1000 }] }), "NO_ACTIVE_MEMBERS");
  });

  test("ngày tương lai → FUTURE_DATE (mọi hàm post)", async () => {
    const tomorrow = addDays(today, 1);
    await expectCode(deposit(a, 1000, tomorrow), "FUTURE_DATE");
    await expectCode(giftPreview(1000, tomorrow), "FUTURE_DATE");
    await expectCode(rpc(db, admin.id, "post_reimbursement", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 1, p_occurred_on: tomorrow }), "FUTURE_DATE");
    await expectCode(rpc(db, admin.id, "preview_purchase", { p_occurred_on: tomorrow, p_paid_by: "FUND", p_payer_user_id: null,
      p_lines: [{ item_name: "x", line_amount_vnd: 1 }] }), "FUTURE_DATE");
  });

  test("membership đổi giữa preview và xác nhận → MEMBERSHIP_CHANGED", async () => {
    const lines = [{ item_name: "Hạt", line_amount_vnd: 90_000 }];
    const preview = await rpc(db, admin.id, "preview_purchase", { p_occurred_on: today, p_paid_by: "FUND", p_payer_user_id: null, p_lines: lines });
    const d = await createUser(db, { code: "D004", username: "dung" });
    await addMembership(db, d.id, addDays(today, -1));
    await expectCode(rpc(db, admin.id, "post_purchase", {
      p_idem_key: uuid(), p_occurred_on: today, p_paid_by: "FUND", p_payer_user_id: null, p_lines: lines,
      p_preview_hash: preview.preview_hash }), "MEMBERSHIP_CHANGED");
    expect((await balances(db)).cash).toBe(0);
  });

  test("gift: preview_hash cũ → MEMBERSHIP_CHANGED", async () => {
    const p = await giftPreview(30_000, today);
    const d = await createUser(db, { code: "D004", username: "dung" });
    await addMembership(db, d.id, today);
    await expectCode(rpc(db, admin.id, "post_gift", { p_idem_key: uuid(), p_amount_vnd: 30_000, p_occurred_on: today,
      p_preview_hash: p.preview_hash }), "MEMBERSHIP_CHANGED");
  });
});

describe("membership theo ngày [start, end)", () => {
  test("vào ngày D bị chia phiếu ngày D; rời ngày D không bị chia", async () => {
    const d = await createUser(db, { code: "D004", username: "dung" });
    const e = await createUser(db, { code: "E005", username: "emm" });
    const day = addDays(today, -5);
    await addMembership(db, d.id, day);                       // vào ngày D
    await addMembership(db, e.id, addDays(today, -30), day);  // rời ngày D
    await purchase([{ item_name: "x", line_amount_vnd: 40_000 }], { on: day });
    expect(await balanceOf(db, d.id)).toBe(-10_000);
    expect(await balanceOf(db, e.id)).toBe(0);
    await purchase([{ item_name: "y", line_amount_vnd: 50_000 }], { on: addDays(day, -1) });
    expect(await balanceOf(db, d.id)).toBe(-10_000);
    expect(await balanceOf(db, e.id)).toBe(-12_500);
  });

  test("chồng khoảng → MEMBERSHIP_OVERLAP; sửa membership không đổi ledger cũ, báo số phiếu lệch", async () => {
    await expectCode(rpc(db, admin.id, "admin_upsert_membership", {
      p_membership_id: null, p_user_id: a.id, p_start_date: today, p_end_date: null, p_reason: "thêm" }), "MEMBERSHIP_OVERLAP");

    const day = addDays(today, -3);
    await purchase([{ item_name: "x", line_amount_vnd: 30_000 }], { on: day });
    await gift(3_000, day);
    const before = await balanceOf(db, c.id);

    const [{ id: mid }] = (await db.query<{ id: string }>(`select id from fund_memberships where user_id = $1`, [c.id])).rows;
    const impact = await rpc(db, admin.id, "admin_membership_impact", {
      p_membership_id: mid, p_user_id: null, p_start_date: addDays(today, -2), p_end_date: null });
    expect(impact.affected_posted_events).toBe(2);

    await expectCode(rpc(db, admin.id, "admin_upsert_membership", {
      p_membership_id: mid, p_user_id: null, p_start_date: addDays(today, -2), p_end_date: null, p_reason: "  " }), "INVALID_INPUT");
    const res = await rpc(db, admin.id, "admin_upsert_membership", {
      p_membership_id: mid, p_user_id: null, p_start_date: addDays(today, -2), p_end_date: null, p_reason: "vào muộn hơn" });
    expect(res.affected_posted_events).toBe(2);
    expect(await balanceOf(db, c.id)).toBe(before); // phiếu cũ KHÔNG bị tính lại
    const audit = await db.query(`select * from audit_events where action = 'membership.update'`);
    expect(audit.rows).toHaveLength(1);
  });
});

describe("đảo giao dịch", () => {
  test("đảo giữ entry_type gốc, ngược dấu, không đọc membership hiện tại; đảo lại khôi phục", async () => {
    const { result } = await purchase([{ item_name: "x", line_amount_vnd: 90_000 }], { paidBy: "MEMBER", payer: a });
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id)]).toEqual([60_000, -30_000]);

    // tập thành viên đổi sau phiếu
    const d = await createUser(db, { code: "D004", username: "dung" });
    await addMembership(db, d.id, today);

    const rev = await rpc(db, admin.id, "reverse_event", { p_event_id: result.event_id, p_reason: "nhập nhầm", p_idem_key: uuid() });
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id), await balanceOf(db, d.id)]).toEqual([0, 0, 0]);
    const types = await db.query<{ entry_type: string; n: number }>(
      `select entry_type, count(*)::int n from member_ledger where event_id = $1 group by 1 order by 1`, [rev.event_id]);
    // thứ tự theo enum member_entry_type
    expect(types.rows).toEqual([{ entry_type: "PURCHASE_SHARE", n: 3 }, { entry_type: "PURCHASE_CREDIT", n: 1 }]);
    const linked = await db.query<{ n: number }>(`select count(*)::int n from member_ledger where event_id = $1 and reverses_entry_id is not null`, [rev.event_id]);
    expect(linked.rows[0].n).toBe(4);

    await expectCode(rpc(db, admin.id, "reverse_event", { p_event_id: result.event_id, p_reason: "lần 2", p_idem_key: uuid() }), "ALREADY_REVERSED");

    // đảo một REVERSAL = khôi phục gốc (quyết định 13c)
    await rpc(db, admin.id, "reverse_event", { p_event_id: rev.event_id, p_reason: "đảo nhầm", p_idem_key: uuid() });
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id), await balanceOf(db, d.id)]).toEqual([60_000, -30_000, 0]);
    await assertInvariant();
  });

  test("đảo quỹ trả: cash cũng được đảo; lý do bắt buộc", async () => {
    await deposit(a, 10_000);
    const { result } = await purchase([{ item_name: "x", line_amount_vnd: 9_000 }]);
    await expectCode(rpc(db, admin.id, "reverse_event", { p_event_id: result.event_id, p_reason: "", p_idem_key: uuid() }), "INVALID_INPUT");
    await rpc(db, admin.id, "reverse_event", { p_event_id: result.event_id, p_reason: "sai", p_idem_key: uuid() });
    expect((await balances(db)).cash).toBe(10_000);
    const ov = await rpc(db, admin.id, "admin_overview", {});
    expect(ov.costs_incurred_vnd).toBe(0);
    expect(ov.fund_spent_vnd).toBe(0);
    await assertInvariant();
  });
});

describe("idempotency & trùng chứng từ", () => {
  test("gửi lại cùng idempotency_key → trả event cũ, không ghi trùng", async () => {
    const key = uuid();
    const r1 = await deposit(a, 30_000, today, key);
    const r2 = await deposit(a, 30_000, today, key);
    expect(r2.event_id).toBe(r1.event_id);
    expect(r2.replayed).toBe(true);
    expect(await balanceOf(db, a.id)).toBe(30_000);

    const lines = [{ item_name: "x", line_amount_vnd: 3_000 }];
    const p1 = await purchase(lines, { key: "11111111-1111-4111-8111-111111111111" });
    const p2 = await purchase(lines, { key: "11111111-1111-4111-8111-111111111111" });
    expect(p2.result.event_id).toBe(p1.result.event_id);
    const n = await db.query<{ n: number }>(`select count(*)::int n from purchases`);
    expect(n.rows[0].n).toBe(1);
  });

  test("gọi song song cùng key → 1 event", async () => {
    const key = uuid();
    const results = await Promise.all([deposit(a, 1_000, today, key), deposit(a, 1_000, today, key), deposit(a, 1_000, today, key)]);
    expect(new Set(results.map((r) => r.event_id)).size).toBe(1);
    expect(await balanceOf(db, a.id)).toBe(1_000);
  });

  test("key dùng cho loại khác → DUPLICATE_REFERENCE; external_ref trùng → DUPLICATE_REFERENCE", async () => {
    const key = uuid();
    await deposit(a, 1_000, today, key);
    await expectCode(rpc(db, admin.id, "post_reimbursement", { p_idem_key: key, p_user_id: a.id, p_amount_vnd: 1, p_occurred_on: today }), "DUPLICATE_REFERENCE");
    await rpc(db, admin.id, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 1, p_occurred_on: today, p_external_ref: "CK-01" });
    await expectCode(rpc(db, admin.id, "post_deposit", { p_idem_key: uuid(), p_user_id: b.id, p_amount_vnd: 1, p_occurred_on: today, p_external_ref: "CK-01" }), "DUPLICATE_REFERENCE");
    await purchase([{ item_name: "x", line_amount_vnd: 3 }], { ref: "HD-1" });
    await expectCode(purchase([{ item_name: "x", line_amount_vnd: 3 }], { ref: "HD-1", paidBy: "MEMBER", payer: a }), "DUPLICATE_REFERENCE");
  });
});

describe("bất biến & sổ chỉ ghi thêm", () => {
  test("chèn dòng lệch → INVARIANT_VIOLATION lúc COMMIT", async () => {
    await expect(db.transaction(async (tx) => {
      const ev = await tx.query<{ id: string }>(
        `insert into fund_events (kind, amount_vnd, occurred_on, actor_user_id, subject_user_id, idempotency_key)
         values ('DEPOSIT', 1000, current_date, $1, $1, gen_random_uuid()) returning id`, [admin.id]);
      await tx.query(`insert into cash_ledger (event_id, entry_type, amount_vnd, occurred_on) values ($1, 'DEPOSIT_IN', 1000, current_date)`, [ev.rows[0].id]);
      await tx.query(`insert into member_ledger (event_id, user_id, entry_type, amount_vnd, occurred_on) values ($1, $2, 'DEPOSIT_CREDIT', 999, current_date)`, [ev.rows[0].id, a.id]);
    })).rejects.toThrow(/INVARIANT_VIOLATION/);
    expect((await db.query(`select * from fund_events`)).rows).toHaveLength(0);
  });

  test("event không có dòng member → INVARIANT_VIOLATION", async () => {
    await expect(db.query(`insert into fund_events (kind, amount_vnd, occurred_on, actor_user_id, subject_user_id, idempotency_key)
       values ('DEPOSIT', 1000, current_date, $1, $1, gen_random_uuid())`, [admin.id])).rejects.toThrow(/INVARIANT_VIOLATION/);
  });

  test("UPDATE/DELETE ledger bị chặn kể cả với owner; fund_events chỉ đổi status", async () => {
    await deposit(a, 1_000);
    await expect(db.query(`update member_ledger set amount_vnd = 1`)).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(db.query(`delete from cash_ledger`)).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(db.query(`update fund_events set amount_vnd = 5`)).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(db.query(`delete from fund_events`)).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(db.query(`delete from audit_events`)).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });
});

describe("quyền", () => {
  test("member gọi RPC tiền → INSUFFICIENT_PERMISSION; anon không được execute", async () => {
    await expectCode(rpc(db, a.id, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 1, p_occurred_on: today }), "INSUFFICIENT_PERMISSION");
    await expectCode(rpc(db, a.id, "admin_list_users"), "INSUFFICIENT_PERMISSION");
    await expect(rpc(db, null, "post_deposit", { p_idem_key: uuid(), p_user_id: a.id, p_amount_vnd: 1, p_occurred_on: today }))
      .rejects.toThrow(/permission denied/);
    await expect(rpc(db, null, "my_balance")).rejects.toThrow(/permission denied/);
  });

  test("member không gọi được schema private, không ghi bảng trực tiếp", async () => {
    await expect(asRole(db, a.id, `select private.members_on(current_date)`)).rejects.toThrow(/permission denied/);
    await expect(asRole(db, a.id, `insert into cash_ledger (event_id, entry_type, amount_vnd, occurred_on) values (gen_random_uuid(), 'DEPOSIT_IN', 1, current_date)`))
      .rejects.toThrow(/permission denied/);
    await expect(asRole(db, a.id, `select * from fund_events`)).rejects.toThrow(/permission denied/);
  });

  test("RLS: member chỉ đọc ledger + hồ sơ của mình", async () => {
    await deposit(a, 1_000);
    await deposit(b, 2_000);
    const rows = await asRole<{ user_id: string }>(db, a.id, `select user_id from member_ledger`);
    expect(rows.map((r) => r.user_id)).toEqual([a.id]);
    const profiles = await asRole<{ id: string }>(db, a.id, `select id from profiles`);
    expect(profiles.map((r) => r.id)).toEqual([a.id]);
  });

  test("my_balance chỉ trả của người gọi; không có tham số user_id", async () => {
    await deposit(a, 1_000);
    await deposit(b, 2_000);
    const mine = await rpc(db, b.id, "my_balance");
    expect(mine.balance_vnd).toBe(2_000);
    expect(mine.breakdown.DEPOSIT_CREDIT).toBe(2_000);
    await expect(rpc(db, b.id, "my_balance", { p_user_id: a.id })).rejects.toThrow();
  });

  test("tài khoản khóa → ACCOUNT_DISABLED; chưa đổi MK → MUST_CHANGE_PASSWORD", async () => {
    await rpc(db, admin.id, "admin_set_user_status", { p_user_id: b.id, p_status: "DISABLED", p_reason: "nghỉ" });
    await expectCode(rpc(db, b.id, "my_balance"), "ACCOUNT_DISABLED");
    const me = await rpc(db, b.id, "me");
    expect(me.status).toBe("DISABLED");
    await expectCode(rpc(db, admin.id, "admin_set_user_status", { p_user_id: admin.id, p_status: "DISABLED", p_reason: "x" }), "INVALID_INPUT");

    const n = await createUser(db, { code: "N010", username: "newbie", mustChange: true });
    await expectCode(rpc(db, n.id, "my_balance"), "MUST_CHANGE_PASSWORD");
    await rpc(db, n.id, "complete_password_change");
    expect((await rpc(db, n.id, "my_balance")).balance_vnd).toBe(0);
  });
});

describe("thành viên xem quỹ và phiếu (6A)", () => {
  test("tổng quỹ thực + danh sách phiếu kèm phần của tôi", async () => {
    for (const u of [a, b, c]) await deposit(u, 30_000);
    await purchase([{ item_name: "Hạt", line_amount_vnd: 10_000 }]);
    const s = await rpc(db, b.id, "fund_summary");
    expect(s.cash_balance_vnd).toBe(80_000);
    const list = await rpc(db, b.id, "list_purchases", {});
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({ total_vnd: 10_000, share_count: 3, my_share_vnd: -3_333, item_summary: "Hạt" });
    const ledger = await rpc(db, b.id, "my_ledger", {});
    expect(ledger.rows.map((r: any) => r.entry_type)).toEqual(["PURCHASE_SHARE", "DEPOSIT_CREDIT"]);
    expect(ledger.rows[0].purchase_id).toBe(list.rows[0].id);
  });
});
