import { beforeEach, describe, expect, test } from "vitest";
import {
  addDays, addMembership, balanceOf, balances, createDb, createUser, expectCode, rpc, vnToday, type Db, type TestUser,
} from "./harness";

let db: Db;
let admin: TestUser;
let a: TestUser;
let b: TestUser;
let today: string;
const sum = (s: string) => s.padEnd(64, "0").slice(0, 64);

beforeEach(async () => {
  db = await createDb();
  today = await vnToday(db);
  admin = await createUser(db, { code: "Z900", username: "admin", role: "ADMIN" });
  a = await createUser(db, { code: "A001", username: "anh" });
  b = await createUser(db, { code: "B002", username: "binh" });
  for (const u of [a, b]) await addMembership(db, u.id, addDays(today, -30));
});

function stage(kind: string, checksum: string, rows: object[]) {
  return rpc(db, admin.id, "import_stage", { p_kind: kind, p_file_name: `${kind}.xlsx`, p_checksum: checksum, p_rows: rows });
}

describe("import Excel", () => {
  test("3 dòng có 1 dòng lỗi → HAS_ERRORS, commit không ghi gì", async () => {
    const job = await stage("DEPOSITS", sum("a1"), [
      { row_no: 2, external_ref: "CK1", occurred_on: today, username: "anh", amount_vnd: 30000 },
      { row_no: 3, external_ref: "CK2", occurred_on: today, username: "khongco", amount_vnd: 30000 },
      { row_no: 4, external_ref: "CK3", occurred_on: today, username: "binh", amount_vnd: 30000 },
    ]);
    expect(job.status).toBe("HAS_ERRORS");
    expect(job.error_count).toBe(1);
    expect(job.rows[1].errors).toContain("Không tìm thấy username");
    const r = await rpc(db, admin.id, "import_commit", { p_job_id: job.id, p_preview_hash: job.preview_hash });
    expect(r.status).toBe("HAS_ERRORS");
    expect(await balances(db)).toEqual({ cash: 0, member: 0 });
  });

  test("commit nguyên khối; import lại cùng file → IMPORT_DUPLICATE_FILE; commit lặp là idempotent", async () => {
    const rows = [
      { row_no: 2, external_ref: "CK1", occurred_on: today, username: "anh", amount_vnd: 30000 },
      { row_no: 3, external_ref: "CK2", occurred_on: today, username: "binh", amount_vnd: 20000, note: "tháng 9" },
    ];
    const job = await stage("DEPOSITS", sum("b1"), rows);
    expect(job.status).toBe("READY");
    expect(job.summary.total_vnd).toBe(50000);
    const r = await rpc(db, admin.id, "import_commit", { p_job_id: job.id, p_preview_hash: job.preview_hash });
    expect(r).toMatchObject({ status: "COMMITTED", documents: 2 });
    expect((await balances(db)).cash).toBe(50000);
    const again = await rpc(db, admin.id, "import_commit", { p_job_id: job.id, p_preview_hash: job.preview_hash });
    expect(again.replayed).toBe(true);
    expect((await balances(db)).cash).toBe(50000);
    await expectCode(stage("DEPOSITS", sum("b1"), rows), "IMPORT_DUPLICATE_FILE");
    // file khác nhưng trùng mã chứng từ → lỗi theo dòng
    const job2 = await stage("DEPOSITS", sum("b2"), rows);
    expect(job2.status).toBe("HAS_ERRORS");
    expect(job2.rows[0].errors).toContain("Mã chứng từ đã được ghi trước đó");
  });

  test("membership đổi sau preview → STALE, không ghi; preview lại rồi commit được", async () => {
    const job = await stage("GIFTS", sum("c1"), [{ row_no: 2, external_ref: "QUA1", occurred_on: today, amount_vnd: 30000 }]);
    expect(job.rows[0].normalized.split).toEqual({ n: 2, base_share_vnd: 15000, remainder: 0 });
    const c = await createUser(db, { code: "C003", username: "chi" });
    await addMembership(db, c.id, today);
    const r = await rpc(db, admin.id, "import_commit", { p_job_id: job.id, p_preview_hash: job.preview_hash });
    expect(r.status).toBe("STALE");
    expect(await balances(db)).toEqual({ cash: 0, member: 0 });
    const st = await db.query<{ status: string }>(`select status from import_jobs where id = $1`, [job.id]);
    expect(st.rows[0].status).toBe("STALE");

    const again = await rpc(db, admin.id, "import_preview", { p_job_id: job.id });
    expect(again.status).toBe("READY");
    await rpc(db, admin.id, "import_commit", { p_job_id: job.id, p_preview_hash: again.preview_hash });
    expect(await balanceOf(db, c.id)).toBe(10000);
  });

  test("phiếu mua nhiều dòng gom theo mã phiếu", async () => {
    const job = await stage("PURCHASES", sum("d1"), [
      { row_no: 2, external_ref: "HD1", occurred_on: today, paid_by: "MEMBER", payer_username: "anh", line_type: "ITEM", item_name: "Hạt", line_amount_vnd: 200000 },
      { row_no: 3, external_ref: "HD1", occurred_on: today, paid_by: "MEMBER", payer_username: "anh", line_type: "FEE", item_name: "Ship", line_amount_vnd: 15000 },
      { row_no: 4, external_ref: "HD1", occurred_on: today, paid_by: "MEMBER", payer_username: "anh", line_type: "DISCOUNT", item_name: "KM", line_amount_vnd: -15000 },
      { row_no: 5, external_ref: "HD2", occurred_on: today, paid_by: "FUND", line_type: "ITEM", item_name: "Sữa", quantity: 2, unit: "hộp", line_amount_vnd: 50000 },
    ]);
    expect(job.status).toBe("READY");
    expect(job.summary.documents).toBe(2);
    await rpc(db, admin.id, "import_commit", { p_job_id: job.id, p_preview_hash: job.preview_hash });
    expect(await balanceOf(db, a.id)).toBe(200000 - 100000 - 25000);
    expect(await balanceOf(db, b.id)).toBe(-100000 - 25000);
    expect((await balances(db)).cash).toBe(-50000);
    const s = await balances(db);
    expect(s.member).toBe(s.cash);
  });

  test("phiếu có dòng mâu thuẫn / người mua không thuộc quỹ → lỗi theo nhóm", async () => {
    const job = await stage("PURCHASES", sum("e1"), [
      { row_no: 2, external_ref: "HD1", occurred_on: today, paid_by: "FUND", item_name: "Hạt", line_amount_vnd: 1000 },
      { row_no: 3, external_ref: "HD1", occurred_on: addDays(today, -1), paid_by: "FUND", item_name: "Sữa", line_amount_vnd: 1000 },
      { row_no: 4, external_ref: "HD2", occurred_on: today, paid_by: "MEMBER", payer_username: "admin", item_name: "x", line_amount_vnd: 1000 },
    ]);
    expect(job.status).toBe("HAS_ERRORS");
    expect(job.rows[0].errors[0]).toMatch(/cùng ngày/);
    expect(job.rows[2].errors[0]).toMatch(/PAYER_NOT_MEMBER/);
  });

  test("MEMBERS: báo tài khoản mới; commit yêu cầu tài khoản đã tạo; tạo membership", async () => {
    const job = await stage("MEMBERS", sum("f1"), [
      { row_no: 2, employee_code: "C003", username: "Chi", display_name: "Chi", role: "MEMBER", start_date: today },
      { row_no: 3, employee_code: "A001", username: "anh", display_name: "Anh", start_date: today },
    ]);
    expect(job.rows[0].normalized.exists).toBe(false);
    expect(job.rows[1].errors).toContain("Trùng khoảng thời gian tham gia quỹ đã có");
    expect(job.status).toBe("HAS_ERRORS");

    const job2 = await stage("MEMBERS", sum("f2"), [
      { row_no: 2, employee_code: "C003", username: "chi", display_name: "Chi", start_date: today },
    ]);
    expect(job2.status).toBe("READY");
    expect(job2.summary.new_accounts).toBe(1);
    const r = await rpc(db, admin.id, "import_commit", { p_job_id: job2.id, p_preview_hash: job2.preview_hash });
    expect(r.status).toBe("HAS_ERRORS"); // tài khoản chưa được tạo
    // server tạo tài khoản (auth + profile) rồi commit lại
    const c = await createUser(db, { code: "C003", username: "chi" });
    const again = await rpc(db, admin.id, "import_preview", { p_job_id: job2.id });
    expect(again.preview_hash).toBe(job2.preview_hash); // tạo tài khoản không làm đổi hash
    const r2 = await rpc(db, admin.id, "import_commit", { p_job_id: job2.id, p_preview_hash: again.preview_hash });
    expect(r2.status).toBe("COMMITTED");
    const m = await db.query(`select * from fund_memberships where user_id = $1`, [c.id]);
    expect(m.rows).toHaveLength(1);
  });

  test("chỉ admin được import", async () => {
    await expectCode(rpc(db, a.id, "import_stage", { p_kind: "DEPOSITS", p_file_name: "x", p_checksum: sum("z"), p_rows: [{}] }), "INSUFFICIENT_PERMISSION");
  });
});
