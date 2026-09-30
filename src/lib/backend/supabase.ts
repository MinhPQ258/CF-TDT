import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Backend, BackendError } from "./types";

function err(e: { code?: string; message: string; details?: string; status?: number } | null | undefined): BackendError | null {
  return e ? { code: e.code, message: e.message, details: e.details, status: e.status } : null;
}

export const supabaseBackend: Backend = {
  kind: "supabase",

  async currentUserId() {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return (data?.claims?.sub as string | undefined) ?? null;
  },

  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const supabase = await createClient();
    const { data, error } = await supabase.schema("api").rpc(fn, args);
    return { data: (data as T) ?? null, error: err(error) };
  },

  async signIn(email, password) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: err(error) };
  },

  async signOut() {
    const supabase = await createClient();
    await supabase.auth.signOut();
  },

  async updatePassword(password) {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    return { error: err(error) };
  },

  admin: {
    async createUser(email, password, meta) {
      const { data, error } = await createAdminClient().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
      return { id: data?.user?.id ?? null, error: err(error) };
    },
    async deleteUser(id) {
      const { error } = await createAdminClient().auth.admin.deleteUser(id);
      return { error: err(error) };
    },
    async updateUser(id, patch) {
      const { error } = await createAdminClient().auth.admin.updateUserById(id, {
        ...(patch.password ? { password: patch.password } : {}),
        ...(patch.email ? { email: patch.email, email_confirm: true } : {}),
        ...(patch.banned === undefined ? {} : { ban_duration: patch.banned ? "876000h" : "none" }),
      });
      return { error: err(error) };
    },
    async listAuthUsers() {
      const admin = createAdminClient();
      const users: import("./types").AuthUserInfo[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return { users, error: err(error) };
        for (const u of data.users) {
          users.push({ id: u.id, email: u.email ?? null, confirmed: Boolean(u.email_confirmed_at),
            banned: Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now()), last_sign_in_at: u.last_sign_in_at ?? null });
        }
        if (data.users.length < 1000) break;
      }
      return { users, error: null };
    },
    async findLoginEmail(username) {
      const admin = createAdminClient();
      const { data, error } = await admin.from("profiles").select("id").eq("username", username.trim().toLowerCase()).maybeSingle();
      if (error) return { email: null, error: err(error) };
      if (!data) return { email: null, error: null };
      const u = await admin.auth.admin.getUserById(data.id as string);
      if (u.error) return { email: null, error: u.error.status === 404 ? null : err(u.error) };
      return { email: u.data.user?.email ?? null, error: null };
    },
    async setMustChangePassword(id, value) {
      const { error } = await createAdminClient().from("profiles").update({ must_change_password: value }).eq("id", id);
      return { error: err(error) };
    },
    async serviceRpc<T>(fn: string, args: Record<string, unknown>) {
      const { data, error } = await createAdminClient().schema("api").rpc(fn, args);
      return { data: (data as T) ?? null, error: err(error) };
    },
  },
};
