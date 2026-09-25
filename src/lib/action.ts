import type { AppError } from "@/lib/errors";

/** Kết quả Server Action dùng chung với useActionState. */
export interface ActionState<T = unknown> {
  ok?: boolean;
  message?: string;
  code?: AppError["code"];
  fieldErrors?: Record<string, string>;
  data?: T;
  /** đổi mỗi lần submit để client biết có kết quả mới */
  at?: number;
}

export const initialState: ActionState = {};

export function fail<T = never>(error: AppError | string, fieldErrors?: Record<string, string>): ActionState<T> {
  if (typeof error === "string") return { ok: false, message: error, fieldErrors, at: Date.now() };
  return { ok: false, message: error.message, code: error.code, fieldErrors, at: Date.now() };
}

export function ok<T>(data?: T, message?: string): ActionState<T> {
  return { ok: true, data, message, at: Date.now() };
}

/** zod issues → { field: message } */
export function zodFieldErrors(issues: { path: (string | number)[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "_");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
