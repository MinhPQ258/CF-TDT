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
};

/** username → email ảo cho Supabase Auth (quyết định 11A) */
export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${serverEnv.authEmailDomain()}`;
}
