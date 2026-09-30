// Biến môi trường. Giá trị bí mật chỉ đọc ở server (không có tiền tố NEXT_PUBLIC_).

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Thiếu biến môi trường ${name} (xem .env.example)`);
  return value;
}

export const publicEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
};

export const serverEnv = {
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
  cronSecret: () => required("CRON_SECRET", process.env.CRON_SECRET),
  authEmailDomain: () => process.env.APP_AUTH_EMAIL_DOMAIN || "coffee.internal",
  /** Mật khẩu mặc định khi tạo tài khoản và khi admin bấm "Đặt lại mật khẩu" */
  defaultPassword: () => process.env.APP_DEFAULT_PASSWORD || process.env.APP_RESET_PASSWORD || "123456",
  /** Bắt đổi mật khẩu ở lần đăng nhập đầu — tắt mặc định (đăng nhập nhanh) */
  forcePasswordChange: () => process.env.APP_FORCE_PASSWORD_CHANGE === "true",
};

/** username → email ảo khi TẠO tài khoản Supabase Auth. Đăng nhập không dùng hàm này (tra theo username). */
export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${serverEnv.authEmailDomain()}`;
}
