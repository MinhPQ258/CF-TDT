"use client";

import { useActionState } from "react";
import { loginAction } from "@/features/auth/actions";
import { initialState } from "@/lib/action";
import { Alert, Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, errProps } from "@/components/form";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [state, action] = useActionState(loginAction, initialState);
  return (
    <form action={action} className="space-y-4" noValidate>
      {initialError && state.ok === undefined && <Alert tone="danger">{initialError}</Alert>}
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Tên đăng nhập" htmlFor="username" error={state.fieldErrors?.username}>
        <Input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required {...errProps(state, "username")} />
      </Field>
      <Field label="Mật khẩu" htmlFor="password" error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required {...errProps(state, "password")} />
      </Field>
      <SubmitButton className="w-full" pendingText="Đang đăng nhập…">Đăng nhập</SubmitButton>
    </form>
  );
}
