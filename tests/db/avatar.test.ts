import { beforeEach, expect, test } from "vitest";
import { createDb, createUser, expectCode, rpc, type Db, type TestUser } from "./harness";

let db: Db;
let a: TestUser;
let b: TestUser;

beforeEach(async () => {
  db = await createDb();
  a = await createUser(db, { code: "NV001", username: "anh", name: "Anh" });
  b = await createUser(db, { code: "NV002", username: "binh", name: "Bình" });
});

test("tự đổi / xoá ảnh đại diện; me trả avatar; không ảnh hưởng người khác", async () => {
  expect((await rpc(db, a.id, "me", {})).avatar).toBeNull();
  const img = "data:image/jpeg;base64," + "A".repeat(20_000);
  await rpc(db, a.id, "set_my_avatar", { p_avatar: img });
  expect((await rpc(db, a.id, "me", {})).avatar).toBe(img);
  expect((await rpc(db, b.id, "me", {})).avatar).toBeNull();
  await rpc(db, a.id, "set_my_avatar", { p_avatar: null });
  expect((await rpc(db, a.id, "me", {})).avatar).toBeNull();
  const audit = await db.query<{ action: string }>(`select action from audit_events where entity_id = $1 order by id`, [a.id]);
  expect(audit.rows.map((r) => r.action)).toEqual(["profile.avatar_set", "profile.avatar_remove"]);
});

test("từ chối ảnh sai định dạng, quá lớn, hoặc chưa đăng nhập", async () => {
  await expectCode(rpc(db, a.id, "set_my_avatar", { p_avatar: "https://evil.example/x.png" }), "INVALID_INPUT");
  await expectCode(rpc(db, a.id, "set_my_avatar", { p_avatar: "data:image/svg+xml;base64,PHN2Zz4=" }), "INVALID_INPUT");
  await expectCode(rpc(db, a.id, "set_my_avatar", { p_avatar: "data:image/png;base64," + "A".repeat(200_001) }), "INVALID_INPUT");
  await expect(rpc(db, null, "set_my_avatar", { p_avatar: "data:image/png;base64,AAAA" })).rejects.toThrow();
});
