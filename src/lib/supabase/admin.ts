import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Client service role. CHỈ dùng cho: auth.admin (tạo tài khoản, đặt lại mật khẩu, khóa phiên)
 * và cron đối soát. Không bao giờ dùng để đọc/ghi sổ thay cho người dùng.
 */
export function createAdminClient() {
  return createClient(publicEnv.supabaseUrl(), serverEnv.serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
