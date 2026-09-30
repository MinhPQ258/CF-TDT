import { beforeEach, describe, expect, test } from "vitest";
import { balances, createDb, createUser, expectCode, rpc, vnToday, type Db, type TestUser } from "./harness";

let db: Db;
let admin: TestUser;
let a: TestUser;
let b: TestUser;
let today: string;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function openSession(name = "Sáng", extra: Record<string, unknown> = {}) {
  return rpc(db, admin.id, "admin_create_vote_session", {
    p_name: name, p_service_date: today, p_opens_at: inMinutes(-10), p_cutoff_at: inMinutes(60),
    p_styles: ["Phin", "Máy", "Cold brew"], p_addons: ["Sữa đặc", "Đường", "Đá"], ...extra,
  });
}

const opt = (s: any, kind: "styles" | "addons", label: string) => s.options[kind].find((o: any) => o.label === label).id as string;

/** Đợt đã quá giờ chốt: API không cho tạo nên chèn trực tiếp. */
async function pastSession() {
  const r = await db.query<{ id: string }>(
    `insert into vote_sessions (name, service_date, opens_at, cutoff_at, status, created_by)
     values ('Cũ', $1, now() - interval '2 hours', now() - interval '1 second', 'PUBLISHED', $2) returning id`,
    [today, admin.id]);
  return r.rows[0].id;
}

function vote(user: TestUser, s: any, style: string, addons: string[] = [], cups = 1) {
  return rpc(db, user.id, "cast_vote", {
    p_session_id: s.id, p_choice: "YES", p_style_option_id: opt(s, "styles", style),
    p_addon_ids: addons.map((x) => opt(s, "addons", x)), p_cups: cups,
  });
}

beforeEach(async () => {
  db = await createDb();
  today = await vnToday(db);
  admin = await createUser(db, { code: "Z900", username: "admin", role: "ADMIN" });
  a = await createUser(db, { code: "A001", username: "anh", name: "Anh" });
  b = await createUser(db, { code: "B002", username: "binh", name: "Bình" });
});

describe("tạo đợt với lựa chọn tùy ý", () => {
  test("kiểu pha + đồ đi kèm theo thứ tự nhập; bỏ trùng, trim", async () => {
    const s = await openSession("Sáng", { p_styles: [" Phin ", "phin", "Máy"], p_addons: ["Đá", "", "Sữa đặc"] });
    expect(s.options.styles.map((o: any) => o.label)).toEqual(["Phin", "Máy"]);
    expect(s.options.addons.map((o: any) => o.label)).toEqual(["Đá", "Sữa đặc"]);
    expect(s.allow_cups).toBe(true);
  });

  test("không truyền lựa chọn → chép đợt gần nhất; không có đợt nào → Phin, Máy", async () => {
    const first = await rpc(db, admin.id, "admin_create_vote_session", {
      p_name: "Đầu tiên", p_service_date: today, p_opens_at: inMinutes(-5), p_cutoff_at: inMinutes(30) });
    expect(first.options.styles.map((o: any) => o.label)).toEqual(["Phin", "Máy"]);
    const custom = await openSession("Custom", { p_allow_cups: false });
    const copied = await rpc(db, admin.id, "admin_create_vote_session", {
      p_name: "Chép", p_service_date: today, p_opens_at: inMinutes(-5), p_cutoff_at: inMinutes(30), p_copy_from: custom.id });
    expect(copied.options.styles.map((o: any) => o.label)).toEqual(["Phin", "Máy", "Cold brew"]);
    expect(copied.options.addons.map((o: any) => o.label)).toEqual(["Sữa đặc", "Đường", "Đá"]);
    expect(copied.allow_cups).toBe(false);
    const templates = await rpc(db, admin.id, "admin_vote_templates");
    expect(templates[0].name).toBe("Chép");
  });

  test("danh sách kiểu pha rỗng / quá dài / quá nhiều → INVALID_INPUT", async () => {
    await expectCode(openSession("x", { p_styles: [] }), "INVALID_INPUT");
    await expectCode(openSession("x", { p_styles: ["x".repeat(41)] }), "INVALID_INPUT");
    await expectCode(openSession("x", { p_styles: Array.from({ length: 11 }, (_, i) => `K${i}`) }), "INVALID_INPUT");
  });

  test("thêm / ẩn lựa chọn: chưa ai chọn thì xóa hẳn, đã có người chọn thì ẩn; phải giữ ≥1 kiểu pha", async () => {
    const s = await openSession();
    let o = await rpc(db, admin.id, "admin_add_vote_option", { p_session_id: s.id, p_kind: "ADDON", p_label: "Kem cheese" });
    expect(o.addons.map((x: any) => x.label)).toContain("Kem cheese");
    await expectCode(rpc(db, admin.id, "admin_add_vote_option", { p_session_id: s.id, p_kind: "ADDON", p_label: "kem CHEESE" }), "DUPLICATE_REFERENCE");
    await vote(a, s, "Phin", ["Đá"]);
    o = await rpc(db, admin.id, "admin_set_vote_option_hidden", { p_option_id: opt(s, "addons", "Đá"), p_hidden: true });
    expect(o.addons.find((x: any) => x.label === "Đá").hidden).toBe(true);
    o = await rpc(db, admin.id, "admin_set_vote_option_hidden", { p_option_id: opt(s, "addons", "Đường"), p_hidden: true });
    expect(o.addons.find((x: any) => x.label === "Đường")).toBeUndefined();
    // phiếu cũ vẫn giữ Đá; phiếu mới không chọn được Đá nữa
    const d = await rpc(db, a.id, "vote_session_detail", { p_session_id: s.id });
    expect(d.my_vote.addon_labels).toEqual(["Đá"]);
    await expectCode(vote(b, s, "Phin", ["Đá"]), "INVALID_INPUT");
    await rpc(db, admin.id, "admin_set_vote_option_hidden", { p_option_id: opt(s, "styles", "Máy"), p_hidden: true });
    await rpc(db, admin.id, "admin_set_vote_option_hidden", { p_option_id: opt(s, "styles", "Cold brew"), p_hidden: true });
    await expectCode(rpc(db, admin.id, "admin_set_vote_option_hidden", { p_option_id: opt(s, "styles", "Phin"), p_hidden: true }), "INVALID_INPUT");
    await expectCode(rpc(db, a.id, "admin_add_vote_option", { p_session_id: s.id, p_kind: "STYLE", p_label: "x" }), "INSUFFICIENT_PERMISSION");
  });

  test("kéo dài giờ chốt; không sửa đợt đã chốt", async () => {
    const s = await openSession();
    const later = inMinutes(120);
    const r = await rpc(db, admin.id, "admin_set_vote_cutoff", { p_session_id: s.id, p_cutoff_at: later });
    expect(new Date(r.cutoff_at).getTime()).toBe(new Date(later).getTime());
    const old = await pastSession();
    await expectCode(rpc(db, admin.id, "admin_set_vote_cutoff", { p_session_id: old, p_cutoff_at: later }), "VOTE_CLOSED");
    await expectCode(rpc(db, admin.id, "admin_set_vote_cutoff", { p_session_id: s.id, p_cutoff_at: inMinutes(-1) }), "INVALID_INPUT");
  });
});

describe("vote", () => {
  test("vote / sửa / rút trước giờ chốt; đếm theo lựa chọn; kết quả có tên; không sinh ledger", async () => {
    const s = await openSession();
    await vote(a, s, "Phin", ["Sữa đặc", "Đá"], 2);
    await vote(b, s, "Máy", ["Đá"]);
    let d = await rpc(db, a.id, "vote_session_detail", { p_session_id: s.id });
    expect(d).toMatchObject({ yes_count: 2, no_count: 0, cups_total: 3 });
    expect(d.by_style).toEqual([{ label: "Phin", people: 1, cups: 2 }, { label: "Máy", people: 1, cups: 1 }]);
    expect(d.by_addon).toEqual([{ label: "Đá", people: 2 }, { label: "Sữa đặc", people: 1 }]);
    expect(d.votes.map((v: any) => v.display_name).sort()).toEqual(["Anh", "Bình"]);
    expect(d.my_vote).toMatchObject({ choice: "YES", style_label: "Phin", addon_labels: ["Sữa đặc", "Đá"], cups: 2 });
    expect(d.not_voted).toBeNull(); // chỉ admin thấy

    // sửa: đổi kiểu, bỏ hết đồ đi kèm
    await vote(a, s, "Cold brew", [], 1);
    d = await rpc(db, admin.id, "vote_session_detail", { p_session_id: s.id });
    expect(d.by_addon).toEqual([{ label: "Đá", people: 1 }]);
    expect(d.not_voted.map((x: any) => x.employee_code)).toEqual(["Z900"]);

    await rpc(db, a.id, "withdraw_vote", { p_session_id: s.id });
    d = await rpc(db, a.id, "vote_session_detail", { p_session_id: s.id });
    expect(d.yes_count).toBe(1);
    expect(d.my_vote).toBeNull();
    expect((await db.query(`select * from votes where user_id = $1 and is_withdrawn`, [a.id])).rows).toHaveLength(1);
    expect(await balances(db)).toEqual({ cash: 0, member: 0 });
  });

  test("Không uống: bỏ kiểu pha, đồ kèm, số cốc", async () => {
    const s = await openSession();
    await vote(a, s, "Phin", ["Đá"]);
    const r = await rpc(db, a.id, "cast_vote", { p_session_id: s.id, p_choice: "NO", p_style_option_id: opt(s, "styles", "Phin"), p_cups: 3 });
    expect(r.my_vote).toMatchObject({ choice: "NO", cups: null, style_option_id: null, addon_ids: [] });
  });

  test("lựa chọn của đợt khác / thiếu kiểu pha / số cốc sai → INVALID_INPUT", async () => {
    const s1 = await openSession("S1");
    const s2 = await openSession("S2");
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: s1.id, p_choice: "YES", p_style_option_id: opt(s2, "styles", "Phin") }), "INVALID_INPUT");
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: s1.id, p_choice: "YES" }), "INVALID_INPUT");
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: s1.id, p_choice: "YES", p_style_option_id: opt(s1, "styles", "Phin"),
      p_addon_ids: [opt(s2, "addons", "Đá")] }), "INVALID_INPUT");
    await expectCode(vote(a, s1, "Phin", [], 21), "INVALID_INPUT");
    // đợt không cho nhập số cốc → cups null, tính 1 cốc
    const s3 = await openSession("S3", { p_allow_cups: false });
    const r = await vote(a, s3, "Phin", [], 5);
    expect(r.my_vote.cups).toBeNull();
    expect(r.cups_total).toBe(1);
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
    await expectCode(vote(a, s1, "Phin"), "VOTE_CLOSED");
    await expectCode(rpc(db, admin.id, "close_vote_early", { p_session_id: s1.id }), "VOTE_CLOSED");
    await expectCode(rpc(db, admin.id, "admin_add_vote_option", { p_session_id: s1.id, p_kind: "ADDON", p_label: "x" }), "VOTE_CLOSED");

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
    expect((await rpc(db, a.id, "home")).sessions).toEqual([]);
    await expectCode(rpc(db, a.id, "vote_session_detail", { p_session_id: draft.id }), "INVALID_INPUT");
    await expectCode(rpc(db, a.id, "cast_vote", { p_session_id: draft.id, p_choice: "NO" }), "INVALID_INPUT");
    await rpc(db, admin.id, "admin_publish_vote_session", { p_session_id: draft.id });
    await rpc(db, a.id, "cast_vote", { p_session_id: draft.id, p_choice: "NO" });
    await expectCode(rpc(db, a.id, "admin_create_vote_session", {
      p_name: "x", p_service_date: today, p_opens_at: inMinutes(-5), p_cutoff_at: inMinutes(30) }), "INSUFFICIENT_PERMISSION");
  });

  test("giờ chốt ≤ giờ mở hoặc đã qua → INVALID_INPUT", async () => {
    await expectCode(openSession("x", { p_opens_at: inMinutes(10), p_cutoff_at: inMinutes(5) }), "INVALID_INPUT");
    await expectCode(openSession("x", { p_opens_at: inMinutes(-10), p_cutoff_at: inMinutes(-5) }), "INVALID_INPUT");
  });

  test("thành viên tạo được đợt (luôn đăng, không nháp); vote_templates cho mọi người", async () => {
    const s = await rpc(db, a.id, "create_vote_session", {
      p_name: "Anh mở", p_service_date: today, p_opens_at: inMinutes(-1), p_cutoff_at: inMinutes(30),
      p_styles: ["Phin"], p_addons: ["Đá"], p_publish: false });
    expect(s).toMatchObject({ status: "PUBLISHED", state: "OPEN" });
    expect((await rpc(db, b.id, "home")).sessions.map((x: any) => x.name)).toContain("Anh mở");
    const t = await rpc(db, b.id, "vote_templates");
    expect(t[0].name).toBe("Anh mở");
    const audit = await db.query<{ n: number }>(`select count(*)::int n from audit_events where action = 'vote.create' and actor_user_id = $1`, [a.id]);
    expect(audit.rows[0].n).toBe(1);
    // điều khiển đợt vẫn chỉ admin
    await expectCode(rpc(db, a.id, "close_vote_early", { p_session_id: s.id }), "INSUFFICIENT_PERMISSION");
    await expectCode(rpc(db, a.id, "admin_vote_templates"), "INSUFFICIENT_PERMISSION");
    // admin vẫn tạo nháp được
    const draft = await rpc(db, admin.id, "create_vote_session", {
      p_name: "Nháp admin", p_service_date: today, p_opens_at: inMinutes(-1), p_cutoff_at: inMinutes(30), p_publish: false });
    expect(draft.status).toBe("DRAFT");
  });

  test("mọi tài khoản ACTIVE được vote kể cả không thuộc quỹ (7A)", async () => {
    const s = await openSession();
    const r = await vote(admin, s, "Máy");
    expect(r.yes_count).toBe(1);
  });

  test("đợt cũ không có lựa chọn vẫn vote bằng coffee_type", async () => {
    const id = (await db.query<{ id: string }>(
      `insert into vote_sessions (name, service_date, opens_at, cutoff_at, status, created_by)
       values ('Legacy', $1, now() - interval '5 minutes', now() + interval '1 hour', 'PUBLISHED', $2) returning id`,
      [today, admin.id])).rows[0].id;
    const r = await rpc(db, a.id, "cast_vote", { p_session_id: id, p_choice: "YES", p_coffee_type: "PHIN", p_cups: 2 });
    expect(r.my_vote).toMatchObject({ style_label: "Phin", cups: 2 });
  });
});

describe("home", () => {
  test("đợt đang mở + điền sẵn từ phiếu gần nhất theo tên lựa chọn", async () => {
    const s1 = await openSession("Hôm qua");
    await vote(a, s1, "Phin", ["Sữa đặc", "Đá"], 2);
    const s2 = await openSession("Hôm nay", { p_styles: ["Máy", "Phin"], p_addons: ["Đá", "Sữa tươi"] });
    const h = await rpc(db, a.id, "home");
    const today2 = h.sessions.find((x: any) => x.id === s2.id);
    expect(today2.prefill).toMatchObject({ choice: "YES", cups: 2, style_option_id: opt(s2, "styles", "Phin") });
    expect(today2.prefill.addon_ids).toEqual([opt(s2, "addons", "Đá")]); // Sữa đặc không còn trong đợt mới → bỏ
    expect(today2.my_vote).toBeNull();
    const mine = h.sessions.find((x: any) => x.id === s1.id);
    expect(mine.my_vote.style_label).toBe("Phin");
    // người chưa vote bao giờ: không có prefill
    expect((await rpc(db, b.id, "home")).sessions[0].prefill).toBeNull();
  });

  test("không có đợt mở: last_closed và next", async () => {
    await pastSession();
    await rpc(db, admin.id, "admin_create_vote_session", {
      p_name: "Mai", p_service_date: today, p_opens_at: inMinutes(60 * 20), p_cutoff_at: inMinutes(60 * 21) });
    const h = await rpc(db, a.id, "home");
    expect(h.sessions).toEqual([]);
    expect(h.last_closed.name).toBe("Cũ");
    expect(h.next.name).toBe("Mai");
  });
});

describe("đặt hộ", () => {
  function voteFor(actor: TestUser, s: any, target: TestUser, style: string, addons: string[] = [], cups = 1) {
    return rpc(db, actor.id, "cast_vote_for", {
      p_session_id: s.id, p_user_id: target.id, p_style_option_id: opt(s, "styles", style),
      p_addon_ids: addons.map((x) => opt(s, "addons", x)), p_cups: cups,
    });
  }

  test("phiếu riêng của người được đặt hộ, lựa chọn riêng, ghi người đặt", async () => {
    const s = await openSession();
    await vote(a, s, "Phin", ["Đá"]);
    const r = await voteFor(a, s, b, "Máy", ["Sữa đặc", "Đường"], 2);
    expect(r.yes_count).toBe(2);
    expect(r.cups_total).toBe(3);
    expect(r.my_proxies).toHaveLength(1);
    expect(r.my_proxies[0]).toMatchObject({ user_id: b.id, style_label: "Máy", cups: 2 });
    const d = await rpc(db, admin.id, "vote_session_detail", { p_session_id: s.id });
    const vb = d.votes.find((v: any) => v.display_name === "Bình");
    expect(vb.voted_by_name).toBe("Anh");
    expect(d.not_voted.map((x: any) => x.display_name)).not.toContain("Bình");
    const home = await rpc(db, b.id, "home", {});
    expect(home.sessions[0].my_vote_by).toBe("Anh");
  });

  test("không đè phiếu người đó đã tự vote; tự vote lại thì phiếu thành của họ", async () => {
    const s = await openSession();
    await vote(b, s, "Phin");
    await expectCode(voteFor(a, s, b, "Máy"), "INVALID_INPUT");
    const s2 = await openSession("Chiều");
    await voteFor(a, s2, b, "Máy");
    await vote(b, s2, "Phin");
    const r = await rpc(db, a.id, "vote_session_detail", { p_session_id: s2.id });
    expect(r.my_proxies).toHaveLength(0);
    expect(r.votes.find((v: any) => v.display_name === "Bình").voted_by_name).toBeNull();
  });

  test("bỏ đặt hộ: chỉ người đã đặt; không đặt hộ chính mình", async () => {
    const s = await openSession();
    await voteFor(a, s, b, "Máy");
    await rpc(db, admin.id, "withdraw_vote_for", { p_session_id: s.id, p_user_id: b.id });
    expect((await rpc(db, a.id, "vote_session_detail", { p_session_id: s.id })).my_proxies).toHaveLength(1);
    const r = await rpc(db, a.id, "withdraw_vote_for", { p_session_id: s.id, p_user_id: b.id });
    expect(r.my_proxies).toHaveLength(0);
    expect(r.yes_count).toBe(0);
    await expectCode(voteFor(a, s, a, "Máy"), "INVALID_INPUT");
    const people = await rpc(db, a.id, "vote_people", { p_session_id: s.id });
    expect(people.map((p: any) => p.display_name)).not.toContain("Anh");
  });
});

describe("chỉnh sửa đợt", () => {
  const update = (s: any, extra: Record<string, unknown> = {}) => rpc(db, admin.id, "admin_update_vote_session", {
    p_session_id: s.id, p_name: "Sáng sửa", p_service_date: today, p_opens_at: inMinutes(-10), p_cutoff_at: inMinutes(90),
    p_allow_cups: false, p_styles: ["Máy", "Latte"], p_addons: ["Đá"], ...extra,
  });

  test("đổi thông tin + đồng bộ lựa chọn: đã có người chọn → ẩn, chưa ai chọn → xóa, mới → thêm", async () => {
    const s = await openSession();
    await vote(a, s, "Phin", ["Sữa đặc"]);
    const r = await update(s);
    expect(r).toMatchObject({ name: "Sáng sửa", allow_cups: false });
    expect(r.planned_brew_at).toBe(r.cutoff_at);
    expect(r.options.styles.map((o: any) => o.label)).toEqual(["Máy", "Latte"]);
    expect(r.options.addons.map((o: any) => o.label)).toEqual(["Đá"]);
    const d = await rpc(db, admin.id, "vote_session_detail", { p_session_id: s.id });
    const hidden = d.options_all.styles.filter((o: any) => o.hidden).map((o: any) => o.label);
    expect(hidden).toEqual(["Phin"]); // Cold brew chưa ai chọn → xóa hẳn
    expect(d.votes[0].style_label).toBe("Phin");
    // thêm lại Phin → hiện lại, không tạo trùng
    const again = await update(s, { p_styles: ["Phin", "Máy"] });
    expect(again.options.styles.map((o: any) => o.label)).toEqual(["Phin", "Máy"]);
  });

  test("chỉ admin; cần ≥1 kiểu pha; giờ chốt ở tương lai", async () => {
    const s = await openSession();
    await expectCode(rpc(db, a.id, "admin_update_vote_session", { p_session_id: s.id, p_name: "x", p_service_date: today,
      p_opens_at: inMinutes(-10), p_cutoff_at: inMinutes(60), p_allow_cups: true, p_styles: ["A"], p_addons: [] }), "INSUFFICIENT_PERMISSION");
    await expectCode(update(s, { p_styles: [] }), "INVALID_INPUT");
    await expectCode(update(s, { p_cutoff_at: inMinutes(-1) }), "INVALID_INPUT");
  });
});
