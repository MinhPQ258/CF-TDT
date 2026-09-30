// Chạy app ở chế độ local: Postgres nhúng (PGlite) tại .local-db/, không cần Supabase/Docker.
// npm run dev:local  → http://localhost:3000   (reset dữ liệu: npm run local:reset)
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  COFFEE_BACKEND: "local",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "http://local.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "local",
  CRON_SECRET: process.env.CRON_SECRET || "local-cron-secret",
  NEXT_TELEMETRY_DISABLED: "1",
};
const port = process.argv[2] || process.env.PORT || "3000";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
