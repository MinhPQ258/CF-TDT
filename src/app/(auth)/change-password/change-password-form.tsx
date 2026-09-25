"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/features/auth/actions";
import { initialState } from "@/lib/action";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, errProps } from "@/components/form";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, initialState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} loginNext="/change-password" />
      <Field label="Mật khẩu hiện tại" htmlFor="current_password" error={state.fieldErrors?.current_password}>
        <Input id="current_password" name="current_password" type="password" autoComplete="current-password" required {...errProps(state, "current_password")} />
      </Field>
      <Field label="Mật khẩu mới" htmlFor="new_password" error={state.fieldErrors?.new_password} hint="Tối thiểu 8 ký tự">
        <Input id="new_password" name="new_password" type="password" autoComplete="new-password" minLength={8} required {...errProps(state, "new_password")} />
      </Field>
      <Field label="Nhập lại mật khẩu mới" htmlFor="confirm_password" error={state.fieldErrors?.confirm_password}>
        <Input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" required {...errProps(state, "confirm_password")} />
      </Field>
      <SubmitButton className="w-full" pendingText="Đang đổi…">Đổi mật khẩu</SubmitButton>
    </form>
  );
}
