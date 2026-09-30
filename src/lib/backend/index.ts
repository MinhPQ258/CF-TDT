import "server-only";
import type { Backend } from "./types";

export type { AuthUserInfo, Backend, BackendError, RpcResponse } from "./types";

/** COFFEE_BACKEND=local → PGlite trên máy (npm run dev:local); mặc định Supabase. */
export function isLocalBackend(): boolean {
  return process.env.COFFEE_BACKEND === "local";
}

let cached: Promise<Backend> | null = null;

export function backend(): Promise<Backend> {
  if (!cached) {
    cached = isLocalBackend()
      ? import("./local").then((m) => m.localBackend)
      : import("./supabase").then((m) => m.supabaseBackend);
  }
  return cached;
}
