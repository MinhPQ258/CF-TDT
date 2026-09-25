// File gộp supabase/deploy/coffee_tdt_full.sql phải chạy được nguyên khối và khớp migrations.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

test("bundle SQL chạy được trên DB trống có shim Supabase", async () => {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function auth.role() returns text language sql stable as $$ select null::text $$;`);
  const sql = readFileSync(join(__dirname, "..", "..", "supabase", "deploy", "coffee_tdt_full.sql"), "utf8");
  for (const f of ["20260925000001_schema.sql", "20260925000011_security.sql"]) expect(sql).toContain(f);
  await db.exec(sql);
  const r = await db.query<{ n: number }>(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'api'`);
  expect(r.rows[0].n).toBeGreaterThan(40);
  const me = await db.query<{ r: unknown }>(`select api.me() r`);
  expect(me.rows[0].r).toBeNull();
});
