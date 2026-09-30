// Chạy migration thật trên PGlite (Postgres WASM) với shim tối thiểu của Supabase:
// roles anon/authenticated/service_role, auth.users, auth.uid(), auth.role().
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text unique, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

export type Db = PGlite;

export async function createDb(): Promise<Db> {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(SUPABASE_SHIM);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} lỗi: ${(e as Error).message}`);
    }
  }
  return db;
}

export interface TestUser {
  id: string;
  username: string;
  employee_code: string;
}

export async function createUser(
  db: Db,
  opts: { code: string; username?: string; name?: string; role?: "MEMBER" | "ADMIN"; mustChange?: boolean },
): Promise<TestUser> {
  const id = randomUUID();
  const username = opts.username ?? opts.code.toLowerCase().replace(/[^a-z0-9._-]/g, "") + "user";
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${username}@coffee.internal`]);
  await db.query(
    `insert into public.profiles (id, employee_code, username, display_name, role, must_change_password)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, opts.code, username, opts.name ?? username, opts.role ?? "MEMBER", opts.mustChange ?? false],
  );
  return { id, username, employee_code: opts.code };
}

/** Thêm membership trực tiếp (bỏ qua API) để dựng dữ liệu nhanh. */
export async function addMembership(db: Db, userId: string, start: string, end: string | null = null) {
  await db.query(
    `insert into public.fund_memberships (user_id, start_date, end_date, reason, created_by, updated_by)
     values ($1, $2, $3, 'test', $1, $1)`,
    [userId, start, end],
  );
}

export class RpcError extends Error {
  constructor(public code: string, public detail: string, public sqlState?: string) {
    super(code + (detail ? `: ${detail}` : ""));
  }
}

function toRpcError(e: unknown): RpcError {
  const err = e as { message?: string; detail?: string; code?: string };
  return new RpcError(err.message ?? String(e), err.detail ?? "", err.code);
}

type Params = Record<string, unknown>;

/** Tham số kiểu mảng Postgres (text[] / uuid[]); các mảng khác là jsonb. */
const PG_ARRAY_PARAMS = new Set(["p_styles", "p_addons", "p_addon_ids"]);

function pgArray(xs: unknown[]): string {
  return `{${xs.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

function buildCall(fn: string, params: Params) {
  const keys = Object.keys(params);
  const values = keys.map((k) => {
    const v = params[k];
    if (Array.isArray(v) && PG_ARRAY_PARAMS.has(k)) return pgArray(v);
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  return { sql: `select api.${fn}(${args}) as r`, values };
}

/** Gọi api.<fn> với vai trò authenticated + JWT sub = userId (hoặc anon nếu userId null). */
export async function rpc<T = any>(db: Db, userId: string | null, fn: string, params: Params = {}): Promise<T> {
  const { sql, values } = buildCall(fn, params);
  try {
    return await db.transaction(async (tx) => {
      await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
      ]);
      const res = await tx.query<{ r: T }>(sql, values);
      return res.rows[0].r;
    });
  } catch (e) {
    throw toRpcError(e);
  }
}

/** Gọi với service_role (cron). */
export async function rpcService<T = any>(db: Db, fn: string, params: Params = {}): Promise<T> {
  const { sql, values } = buildCall(fn, params);
  try {
    return await db.transaction(async (tx) => {
      await tx.exec(`set local role service_role`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "service_role" })]);
      const res = await tx.query<{ r: T }>(sql, values);
      return res.rows[0].r;
    });
  } catch (e) {
    throw toRpcError(e);
  }
}

/** Chạy SQL tùy ý với một role (để kiểm RLS/quyền). */
export async function asRole<T = any>(db: Db, userId: string, sql: string, values: unknown[] = []): Promise<T[]> {
  try {
    return await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      const res = await tx.query<T>(sql, values);
      return res.rows;
    });
  } catch (e) {
    throw toRpcError(e);
  }
}

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpcError && e.code === code) return e;
    throw new Error(`Mong đợi ${code}, nhận ${(e as Error).message}`);
  }
  throw new Error(`Mong đợi ${code}, nhưng lệnh thành công`);
}

export async function balances(db: Db) {
  const cash = await db.query<{ s: string }>(`select coalesce(sum(amount_vnd),0)::text s from public.cash_ledger`);
  const member = await db.query<{ s: string }>(`select coalesce(sum(amount_vnd),0)::text s from public.member_ledger`);
  return { cash: Number(cash.rows[0].s), member: Number(member.rows[0].s) };
}

export async function balanceOf(db: Db, userId: string): Promise<number> {
  const r = await db.query<{ s: string }>(
    `select coalesce(sum(amount_vnd),0)::text s from public.member_ledger where user_id = $1`,
    [userId],
  );
  return Number(r.rows[0].s);
}

export async function vnToday(db: Db): Promise<string> {
  const r = await db.query<{ d: string }>(`select private.vn_today()::text d`);
  return r.rows[0].d;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const uuid = randomUUID;
