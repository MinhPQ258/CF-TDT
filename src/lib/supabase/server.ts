import "server-only";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/** Client Supabase dùng JWT của người dùng (RLS + kiểm quyền trong hàm RPC áp dụng). */
export async function createClient() {
  const cookieStore = await cookies();
  const requestId = (await headers()).get("x-request-id") ?? undefined;
  return createServerClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    global: { headers: requestId ? { "x-request-id": requestId } : {} },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Gọi từ Server Component (không ghi được cookie) — middleware đã làm mới phiên.
          return;
        }
      },
    },
  });
}
