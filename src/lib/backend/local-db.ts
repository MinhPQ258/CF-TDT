import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";

// Postgres nhúng (PGlite, WASM) cho chế độ local. Chạy ĐÚNG supabase/migrations/*.sql, cộng một shim tối thiểu
// của Supabase (roles, auth.users, auth.uid()/auth.role() đọc request.jwt.claims) và bảng mật khẩu local.

const SHIM = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text unique, created_at timestamptz default now());
create table if not exists auth.local_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  password_hash text not null,
  banned boolean not null default false
);
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$f$;
create or replace function auth.role() returns text language sql stable as $f$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$f$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists local_meta;
create table if not exists local_meta.migrations (name text primary key, applied_at timestamptz default now());
`;

type Global = typeof globalThis & { __coffeeLocalDb?: Promise<PGlite> };

export function localDbDir(): string {
  return process.env.LOCAL_DB_DIR || join(process.cwd(), ".local-db");
}

async function open(): Promise<PGlite> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const db = await PGlite.create({ dataDir: localDbDir(), extensions: { btree_gist } });
  await db.exec(SHIM);
  const dir = join(process.cwd(), "supabase", "migrations");
  const applied = new Set((await db.query<{ name: string }>(`select name from local_meta.migrations`)).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (applied.has(f)) continue;
    try {
      await db.transaction(async (tx) => {
        await tx.exec(readFileSync(join(dir, f), "utf8"));
        await tx.query(`insert into local_meta.migrations (name) values ($1)`, [f]);
      });
      console.info(JSON.stringify({ level: "info", action: "local.migrate", code: "OK", params: { file: f } }));
    } catch (e) {
      throw new Error(`[local-db] migration ${f} lỗi: ${(e as Error).message}`);
    }
  }
  const { seedLocal } = await import("./local-seed");
  await seedLocal(db, (claims, fn, args) => rpcOn(db, claims, fn, args), hashPassword,
    process.env.APP_AUTH_EMAIL_DOMAIN || "coffee.internal");
  return db;
}

/** Một instance cho cả tiến trình (Next dev nạp module nhiều lần) */
export function localDb(): Promise<PGlite> {
  const g = globalThis as Global;
  if (!g.__coffeeLocalDb) {
    g.__coffeeLocalDb = open().catch((e) => {
      g.__coffeeLocalDb = undefined;
      throw e;
    });
  }
  return g.__coffeeLocalDb;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(got, expected);
}

// ───────── Gọi hàm api.* như PostgREST: đặt role + JWT claims trong transaction ─────────

type ArgTypes = Map<string, Map<string, string>>;
let argTypesCache: Promise<ArgTypes> | null = null;

async function argTypes(db: PGlite): Promise<ArgTypes> {
  if (!argTypesCache) {
    argTypesCache = db.query<{ proname: string; names: string[] | null; types: string[] }>(`
      select p.proname, p.proargnames as names,
             array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'`).then((r) => {
      const m: ArgTypes = new Map();
      for (const row of r.rows) {
        const t = new Map<string, string>();
        (row.names ?? []).forEach((name, i) => { if (row.types[i]) t.set(name, row.types[i]); });
        m.set(row.proname, t);
      }
      return m;
    });
  }
  return argTypesCache;
}

function pgArray(xs: unknown[]): string {
  return `{${xs.map((x) => (x === null ? "NULL" : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;
}

export interface LocalRpcError {
  code?: string;
  message: string;
  details?: string;
}

export async function localRpc<T>(
  claims: Record<string, unknown>, fn: string, args: Record<string, unknown>, requestId?: string | null,
): Promise<{ data: T | null; error: LocalRpcError | null }> {
  return rpcOn<T>(await localDb(), claims, fn, args, requestId);
}

async function rpcOn<T>(
  db: PGlite, claims: Record<string, unknown>, fn: string, args: Record<string, unknown>, requestId?: string | null,
): Promise<{ data: T | null; error: LocalRpcError | null }> {
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return { data: null, error: { code: "PGRST202", message: `Không có hàm ${fn}` } };
  const types = (await argTypes(db)).get(fn);
  if (!types) return { data: null, error: { code: "PGRST202", message: `Không có hàm api.${fn}` } };
  const keys = Object.keys(args).filter((k) => args[k] !== undefined);
  for (const k of keys) {
    if (!types.has(k)) return { data: null, error: { code: "PGRST202", message: `api.${fn} không có tham số ${k}` } };
  }
  const values = keys.map((k) => {
    const v = args[k];
    const t = types.get(k)!;
    if (v === null) return null;
    if (t.endsWith("[]") && Array.isArray(v)) return pgArray(v);
    if (t === "jsonb" || t === "json") return JSON.stringify(v);
    return v;
  });
  const call = `select api.${fn}(${keys.map((k, i) => `${k} => $${i + 1}::${types.get(k)}`).join(", ")}) as r`;
  const role = (claims.role as string) === "service_role" ? "service_role" : claims.sub ? "authenticated" : "anon";
  try {
    const data = await db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`,
        [JSON.stringify(claims), JSON.stringify(requestId ? { "x-request-id": requestId } : {})]);
      const res = await tx.query<{ r: T }>(call, values);
      return res.rows[0]?.r ?? null;
    });
    return { data, error: null };
  } catch (e) {
    const x = e as { code?: string; message?: string; detail?: string };
    return { data: null, error: { code: x.code, message: x.message ?? String(e), details: x.detail } };
  }
}
