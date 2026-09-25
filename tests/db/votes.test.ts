import { beforeEach, describe, expect, test } from "vitest";
import { balances, createDb, createUser, expectCode, rpc, vnToday, type Db, type TestUser } from "./harness";

let db: Db;
let admin: TestUser;
let a: TestUser;
let b: TestUser;
let today: string;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function openSession(name = "Sáng") {
  return rpc(db, admin.id, "admin_create_vote_session", {
    p_name: name, p_service_date: today, p_opens_at: inMinutes(-10), p_cutoff_at: inMinutes(60),
  });
}

/** Đợt đã quá giờ chốt: API không cho tạo nên chèn trực tiếp. */
async function pastSession() {
  const r = await db.query<{ id: string }>(
    `insert into vote_sessions (name, service_date, opens_at, cutoff_at, status, created_by)
     values ('Cũ', $1, now() - interval '2 hours', now() - interval '1 second', 'PUBLISHED', $2) returning id`,
    [today, admin.id]);
  return r.rows[0].id;
}

beforeEach(async () => {
  db = await createDb();
  today = await vnToday(db);
  admin = await createUser(db, { code: "Z900", username: "admin", role: "ADMIN" });
  a = await createUser(db, { code: "A001", username: "anh", name: "Anh" });
  b = await createUser(db, { code: "B002", username: "binh", name: "Bình" });
});

describe("vote", () => {
  test("vote / sửa / rút trước giờ chốt; kết quả có tên; không sinh ledger", async () => {
    const s = await openSession();
    expect(s.state).toBe("OPEN");
    await rpc(db, a.id, "cast_vote", { p_session_id: s.id, p_choice: "YES", p_coffee_type: "PHIN", p_cups: 2 });
    await rpc(db, b.id, "cast_vote", { p_session_id: s.id, p_choice: "NO" });
    let d = await rpc(db, a.id, "vote_session_detail", { p_session_id: s.id });
    expect(d).toMatchObject({ yes_count: 1, no_count: 1, cups_total: 2 });
    expect(d.votes.map((v: any) => v.display_name).sort()).toEqual(["Anh", "Bình"]);
    expect(d.by_type.PHIN).toEqual({ people: 1, cups: 2 });
    expect(d.my_vote.choice).toBe("YES");

    await rpc(db, a.id, "cast_vote", { p_session_id: s.id, p_choice: "YES", p_coffee_type: "MACHINE", p_cups: 1 });
    d = await rpc(db, a.id, "vote_session_detail", { p_session_id: s.id });
    expect(d.cups_total).toBe(1);
    expect(d.by_type.MACHINE).toEqual({ people: 1, cups: 1 });

    await rpc(db, a.id, "withdraw_vote", { p_session_id: s.id });
    d = await rpc(db, a.id, "vote_session_detail", { p_session_id: s.id });
    expect(d.yes_count).toBe(0);
    expect(d.my_vote).toBeNull();
    // rút phiếu giữ dòng để audit
    expect((await db.query(`select * from votes where user_id = $1 and is_withdrawn`, [a.id])).rows).toHaveLength(1);
    expect(await balances(db)).toEqual({ cash: 0, member: 0 });
  });

  test("YES thiếu số cốc / NO kèm số cốc bị bỏ", async () => {
    const s = await openSession();
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: s.id, p_choice: "YES", p_coffee_type: "PHIN", p_cups: null }), "INVALID_INPUT");
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: s.id, p_choice: "YES", p_coffee_type: "PHIN", p_cups: 21 }), "INVALID_INPUT");
    const r = await rpc(db, a.id, "cast_vote", { p_session_id: s.id, p_choice: "NO", p_coffee_type: "PHIN", p_cups: 3 });
    expect(r.my_vote).toMatchObject({ choice: "NO", cups: null, coffee_type: null });
  });

  test("sau giờ chốt → VOTE_CLOSED; trước giờ mở → VOTE_NOT_OPEN", async () => {
    const id = await pastSession();
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: id, p_choice: "NO" }), "VOTE_CLOSED");
    await expectCode(rpc(db, a.id, "withdraw_vote", { p_session_id: id }), "VOTE_CLOSED");
    const future = await rpc(db, admin.id, "admin_create_vote_session", {
      p_name: "Chiều", p_service_date: today, p_opens_at: inMinutes(30), p_cutoff_at: inMinutes(90) });
    expect(future.state).toBe("UPCOMING");
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: future.id, p_choice: "NO" }), "VOTE_NOT_OPEN");
  });

  test("chốt sớm / hủy → không nhận vote; 2 đợt/ngày", async () => {
    const s1 = await openSession("Sáng");
    const s2 = await openSession("Pha thêm");
    await rpc(db, a.id, "cast_vote", { p_session_id: s1.id, p_choice: "NO" });
    const closed = await rpc(db, admin.id, "close_vote_early", { p_session_id: s1.id });
    expect(closed.state).toBe("CLOSED");
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: s1.id, p_choice: "YES", p_coffee_type: "PHIN", p_cups: 1 }), "VOTE_CLOSED");
    await expectCode(rpc(db, admin.id, "close_vote_early", { p_session_id: s1.id }), "VOTE_CLOSED");

    await expectCode(rpc(db, admin.id, "admin_cancel_vote_session", { p_session_id: s2.id, p_reason: "" }), "INVALID_INPUT");
    await rpc(db, admin.id, "admin_cancel_vote_session", { p_session_id: s2.id, p_reason: "hết hạt" });
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: s2.id, p_choice: "NO" }), "VOTE_CLOSED");
    const list = await rpc(db, a.id, "list_vote_sessions", {});
    expect(list.map((x: any) => x.state).sort()).toEqual(["CANCELLED", "CLOSED"]);
  });

  test("đợt nháp: member không thấy; admin đăng mới mở; member không được tạo đợt", async () => {
    const draft = await rpc(db, admin.id, "admin_create_vote_session", {
      p_name: "Nháp", p_service_date: today, p_opens_at: inMinutes(-5), p_cutoff_at: inMinutes(30), p_publish: false });
    expect(await rpc(db, a.id, "list_vote_sessions", {})).toEqual([]);
    await expectCode(rpc(db, a.id, "vote_session_detail", { p_session_id: draft.id }), "INVALID_INPUT");
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: draft.id, p_choice: "NO" }), "INVALID_INPUT");
    await rpc(db, admin.id, "admin_publish_vote_session", { p_session_id: draft.id });
    await rpc(db, a.id, "cast_vote", { p_session_id: draft.id, p_choice: "NO" });
    await expectCode(rpc(db, a.id, "admin_create_vote_session", {
      p_name: "x", p_service_date: today, p_opens_at: inMinutes(-5), p_cutoff_at: inMinutes(30) }), "INSUFFICIENT_PERMISSION");
  });

  test("giờ chốt ≤ giờ mở hoặc đã qua → INVALID_INPUT", async () => {
    await expectCode(rpc(db, admin.id, "admin_create_vote_session", {
      p_name: "x", p_service_date: today, p_opens_at: inMinutes(10), p_cutoff_at: inMinutes(5) }), "INVALID_INPUT");
    await expectCode(rpc(db, admin.id, "admin_create_vote_session", {
      p_name: "x", p_service_date: today, p_opens_at: inMinutes(-10), p_cutoff_at: inMinutes(-5) }), "INVALID_INPUT");
  });

  test("mọi tài khoản ACTIVE được vote kể cả không thuộc quỹ (7A)", async () => {
    const s = await openSession();
    const r = await rpc(db, admin.id, "cast_vote", { p_session_id: s.id, p_choice: "YES", p_coffee_type: "UNDECIDED", p_cups: 1 });
    expect(r.yes_count).toBe(1);
  });
});
