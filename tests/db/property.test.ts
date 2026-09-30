// Property test: chuỗi ngẫu nhiên giao dịch + khóa/mở tài khoản → sau mỗi bước Σmember = Σcash
// và mỗi phiếu/quà có tổng phần chia đúng bằng số tiền.
import { expect, test } from "vitest";
import fc from "fast-check";
import { addDays, balances, createDb, createUser, rpc, uuid, vnToday, type TestUser } from "./harness";

test("200 giao dịch ngẫu nhiên giữ bất biến", async () => {
  const db = await createDb();
  const today = await vnToday(db);
  const admin = await createUser(db, { code: "Z900", username: "admin", role: "ADMIN" });
  const users: TestUser[] = [];
  for (let i = 0; i < 6; i++) users.push(await createUser(db, { code: `M${100 + i}`, username: `mem${i}` }));
  // admin + 4 tài khoản ACTIVE được chia; 2 tài khoản bắt đầu ở trạng thái khóa
  for (const u of users.slice(4)) {
    await rpc(db, admin.id, "admin_set_user_status", { p_user_id: u.id, p_status: "DISABLED", p_reason: "seed" });
  }

  const op = fc.oneof(
    fc.record({ t: fc.constant("deposit"), u: fc.nat(5), amt: fc.integer({ min: 1, max: 500_000 }), d: fc.nat(30) }),
    fc.record({ t: fc.constant("gift"), amt: fc.integer({ min: 1, max: 200_000 }), d: fc.nat(30) }),
    fc.record({ t: fc.constant("purchase"), member: fc.boolean(), u: fc.nat(5),
      amts: fc.array(fc.integer({ min: 0, max: 99_999 }), { minLength: 1, maxLength: 4 }), disc: fc.nat(5_000), d: fc.nat(30) }),
    fc.record({ t: fc.constant("reimburse"), u: fc.nat(5), amt: fc.integer({ min: 1, max: 100_000 }), d: fc.nat(30) }),
    fc.record({ t: fc.constant("reverse"), pick: fc.nat(1000) }),
    fc.record({ t: fc.constant("status"), u: fc.nat(5), active: fc.boolean() }),
  );

  const ops = fc.sample(fc.array(op, { minLength: 200, maxLength: 200 }), { numRuns: 1, seed: 20260925 })[0];
  const events: string[] = [];
  let posted = 0;
  for (const o of ops as any[]) {
    try {
      if (o.t === "deposit") {
        events.push((await rpc(db, admin.id, "post_deposit", { p_idem_key: uuid(), p_user_id: users[o.u].id, p_amount_vnd: o.amt, p_occurred_on: addDays(today, -o.d) })).event_id);
      } else if (o.t === "reimburse") {
        events.push((await rpc(db, admin.id, "post_reimbursement", { p_idem_key: uuid(), p_user_id: users[o.u].id, p_amount_vnd: o.amt, p_occurred_on: addDays(today, -o.d) })).event_id);
      } else if (o.t === "gift") {
        const on = addDays(today, -o.d);
        const p = await rpc(db, admin.id, "preview_gift", { p_amount_vnd: o.amt, p_occurred_on: on });
        expect(p.members.reduce((s: number, m: any) => s + m.share_vnd, 0)).toBe(o.amt);
        const active = await db.query<{ n: number }>(`select count(*)::int n from public.profiles where status = 'ACTIVE'`);
        expect(p.split.n).toBe(active.rows[0].n); // chia cho đúng mọi tài khoản ACTIVE (kể cả admin)
        events.push((await rpc(db, admin.id, "post_gift", { p_idem_key: uuid(), p_amount_vnd: o.amt, p_occurred_on: on, p_preview_hash: p.preview_hash })).event_id);
      } else if (o.t === "purchase") {
        const on = addDays(today, -o.d);
        const lines = o.amts.map((x: number, i: number) => ({ line_type: "ITEM", item_name: `m${i}`, line_amount_vnd: x }));
        if (o.disc > 0) lines.push({ line_type: "DISCOUNT", item_name: "km", line_amount_vnd: -o.disc });
        const args = { p_occurred_on: on, p_paid_by: o.member ? "MEMBER" : "FUND", p_payer_user_id: o.member ? users[o.u].id : null, p_lines: lines };
        const p = await rpc(db, admin.id, "preview_purchase", args);
        expect(p.members.reduce((s: number, m: any) => s + m.share_vnd, 0)).toBe(-p.total_vnd);
        events.push((await rpc(db, admin.id, "post_purchase", { ...args, p_idem_key: uuid(), p_preview_hash: p.preview_hash })).event_id);
      } else if (o.t === "reverse" && events.length > 0) {
        events.push((await rpc(db, admin.id, "reverse_event", { p_event_id: events[o.pick % events.length], p_reason: "prop", p_idem_key: uuid() })).event_id);
      } else if (o.t === "status") {
        await rpc(db, admin.id, "admin_set_user_status", { p_user_id: users[o.u].id,
          p_status: o.active ? "ACTIVE" : "DISABLED", p_reason: "prop" });
      }
      posted++;
    } catch (e) {
      // Lỗi nghiệp vụ hợp lệ (PAYER_NOT_MEMBER = người mua hộ đang bị khóa, ALREADY_REVERSED, tổng ≤ 0...).
      // Không thể NO_ACTIVE_MEMBERS vì admin luôn ACTIVE.
      const msg = (e as Error).message;
      expect(msg).toMatch(/^(PAYER_NOT_MEMBER|ALREADY_REVERSED|INVALID_INPUT)/);
    }
    const s = await balances(db);
    expect(s.member).toBe(s.cash);
  }
  expect(posted).toBeGreaterThan(100);
  const bad = await db.query(`select private.bad_events() as b`);
  expect((bad.rows[0] as any).b).toEqual([]);
}, 600_000);
