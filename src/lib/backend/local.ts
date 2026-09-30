import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { Backend } from "./types";
import { hashPassword, localDb, localRpc, verifyPassword } from "./local-db";
import { LOCAL_SESSION_COOKIE, signSession, verifySession } from "./local-session";

// Chế độ local: thay Supabase Auth bằng bảng auth.local_credentials + cookie ký HMAC. Chỉ dùng trên máy dev.

const INVALID = { code: "invalid_credentials", message: "Invalid login credentials", status: 400 };

async function requestId() {
  return (await headers()).get("x-request-id");
}

export const localBackend: Backend = {
  kind: "local",

  async currentUserId() {
    const id = await verifySession((await cookies()).get(LOCAL_SESSION_COOKIE)?.value);
    if (!id) return null;
    const db = await localDb();
    const r = await db.query<{ banned: boolean }>(`select banned from auth.local_credentials where user_id = $1`, [id]);
    return r.rows[0] && !r.rows[0].banned ? id : null;
  },

  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const uid = await this.currentUserId();
    return localRpc<T>(uid ? { sub: uid, role: "authenticated" } : { role: "anon" }, fn, args, await requestId());
  },

  async signIn(email, password) {
    const db = await localDb();
    const r = await db.query<{ id: string; password_hash: string; banned: boolean }>(
      `select u.id, c.password_hash, c.banned from auth.users u join auth.local_credentials c on c.user_id = u.id where lower(u.email) = lower($1)`,
      [email]);
    const row = r.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) return { error: INVALID };
    if (row.banned) return { error: { code: "user_banned", message: "User is banned", status: 400 } };
    (await cookies()).set(LOCAL_SESSION_COOKIE, await signSession(row.id), {
      httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    return { error: null };
  },

  async signOut() {
    (await cookies()).delete(LOCAL_SESSION_COOKIE);
  },

  async updatePassword(password) {
    const uid = await this.currentUserId();
    if (!uid) return { error: { code: "no_session", message: "Auth session missing", status: 401 } };
    if (password.length < 8) return { error: { code: "weak_password", message: "Password should be at least 8 characters" } };
    const db = await localDb();
    await db.query(`update auth.local_credentials set password_hash = $2 where user_id = $1`, [uid, hashPassword(password)]);
    return { error: null };
  },

  admin: {
    async createUser(email, password) {
      const db = await localDb();
      const exists = await db.query(`select 1 from auth.users where lower(email) = lower($1)`, [email]);
      if (exists.rows.length) return { id: null, error: { code: "email_exists", message: "A user with this email address has already been registered" } };
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email.toLowerCase()]);
        await tx.query(`insert into auth.local_credentials (user_id, password_hash) values ($1, $2)`, [id, hashPassword(password)]);
      });
      return { id, error: null };
    },
    async deleteUser(id) {
      const db = await localDb();
      try {
        await db.query(`delete from auth.users where id = $1`, [id]);
        return { error: null };
      } catch (e) {
        return { error: { message: (e as Error).message } };
      }
    },
    async updateUser(id, patch) {
      const db = await localDb();
      if (patch.password) await db.query(`update auth.local_credentials set password_hash = $2 where user_id = $1`, [id, hashPassword(patch.password)]);
      if (patch.banned !== undefined) await db.query(`update auth.local_credentials set banned = $2 where user_id = $1`, [id, patch.banned]);
      if (patch.email) await db.query(`update auth.users set email = lower($2) where id = $1`, [id, patch.email]);
      return { error: null };
    },
    async listAuthUsers() {
      const db = await localDb();
      const r = await db.query<{ id: string; email: string; banned: boolean | null }>(
        `select u.id, u.email, c.banned from auth.users u left join auth.local_credentials c on c.user_id = u.id`);
      return { users: r.rows.map((x) => ({ id: x.id, email: x.email, confirmed: true, banned: Boolean(x.banned), last_sign_in_at: null })), error: null };
    },
    async findLoginEmail(username) {
      const db = await localDb();
      const r = await db.query<{ email: string }>(
        `select u.email from public.profiles p join auth.users u on u.id = p.id where p.username = lower($1)`, [username.trim()]);
      return { email: r.rows[0]?.email ?? null, error: null };
    },
    async setMustChangePassword(id, value) {
      const db = await localDb();
      await db.query(`update public.profiles set must_change_password = $2 where id = $1`, [id, value]);
      return { error: null };
    },
    async serviceRpc<T>(fn: string, args: Record<string, unknown>) {
      return localRpc<T>({ role: "service_role" }, fn, args, await requestId());
    },
  },
};
