"use client";

import { useActionState } from "react";
import { createUserAction } from "@/features/users/actions";
import type { ActionState } from "@/lib/action";
import type { CreatedAccount } from "@/features/users/service";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, errProps, useResetOnSuccess } from "@/components/form";

/** Tạo nhanh: chỉ nhập username; mã NV tự sinh, tên hiển thị = username, mật khẩu mặc định */
export function CreateUserForm({ defaultPassword }: { defaultPassword: string }) {
  const [state, action] = useActionState<ActionState<CreatedAccount>, FormData>(createUserAction, {});
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <FormMessage state={state} loginNext="/admin/users" />
      {state.ok && state.data && (
        <p className="rounded-lg bg-ok-soft p-2 text-sm" role="status">
          Đăng nhập: <strong>{state.data.username}</strong> / <code className="font-mono font-semibold">{state.data.temp_password}</code>
        </p>
      )}
      <Field label="Username" htmlFor="username" error={state.fieldErrors?.username} required hint="3–32 ký tự: a-z 0-9 . _ -">
        <Input id="username" name="username" autoCapitalize="none" autoComplete="off" spellCheck={false} required placeholder="vd: nguyenvana"
          {...errProps(state, "username")} />
      </Field>
      <p className="text-sm text-muted">Mật khẩu mặc định <code className="font-mono">{defaultPassword}</code>. Mã NV tự sinh, tên hiển thị = username.</p>
      <SubmitButton className="w-full" pendingText="Đang tạo…">Tạo người dùng</SubmitButton>
    </form>
  );
}
