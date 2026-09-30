"use client";

import { useActionState } from "react";
import { createUserAction } from "@/features/users/actions";
import type { ActionState } from "@/lib/action";
import type { CreatedAccount } from "@/features/users/service";
import { Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton, errProps, useResetOnSuccess } from "@/components/form";
import { TempPassword } from "./temp-password";

export function CreateUserForm() {
  const [state, action] = useActionState<ActionState<CreatedAccount>, FormData>(createUserAction, {});
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <FormMessage state={state} loginNext="/admin/users" />
      {state.ok && state.data && <TempPassword username={state.data.username} password={state.data.temp_password} />}
      <Field label="Mã nhân viên" htmlFor="employee_code" error={state.fieldErrors?.employee_code} required hint="Quyết định thứ tự nhận phần dư 1đ">
        <Input id="employee_code" name="employee_code" required {...errProps(state, "employee_code")} />
      </Field>
      <Field label="Tên đăng nhập" htmlFor="username" error={state.fieldErrors?.username} required>
        <Input id="username" name="username" autoCapitalize="none" spellCheck={false} required {...errProps(state, "username")} />
      </Field>
      <Field label="Tên hiển thị" htmlFor="display_name" error={state.fieldErrors?.display_name} required>
        <Input id="display_name" name="display_name" required {...errProps(state, "display_name")} />
      </Field>
      <Field label="Vai trò" htmlFor="role">
        <Select id="role" name="role" defaultValue="MEMBER">
          <option value="MEMBER">Thành viên</option>
          <option value="ADMIN">Quản trị</option>
        </Select>
      </Field>
      <p className="text-sm text-muted">Mật khẩu mặc định sẽ hiện sau khi tạo. Mọi tài khoản đang hoạt động đều được chia đều chi phí quỹ.</p>
      <SubmitButton className="w-full" pendingText="Đang tạo…">Tạo tài khoản</SubmitButton>
    </form>
  );
}
