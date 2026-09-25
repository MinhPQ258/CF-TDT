"use client";

import { useActionState } from "react";
import { resetPasswordAction, setUserRoleAction, setUserStatusAction } from "@/features/users/actions";
import type { ActionState } from "@/lib/action";
import type { AdminUser } from "@/lib/types";
import { Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";
import { TempPassword } from "./temp-password";

export function UserActions({ user }: { user: AdminUser }) {
  const [sState, setStatus] = useActionState<ActionState, FormData>(setUserStatusAction, {});
  const [rState, setRole] = useActionState<ActionState, FormData>(setUserRoleAction, {});
  const [pState, reset] = useActionState<ActionState<{ temp_password: string }>, FormData>(resetPasswordAction, {});
  const disable = user.status === "ACTIVE";
  const toAdmin = user.role === "MEMBER";

  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-brand">Thao tác…</summary>
      <div className="mt-2 grid gap-3 rounded-lg bg-bg p-3 md:grid-cols-3">
        <form action={setStatus} className="space-y-2">
          <FormMessage state={sState} />
          <input type="hidden" name="user_id" value={user.id} />
          <input type="hidden" name="status" value={disable ? "DISABLED" : "ACTIVE"} />
          <Input name="reason" placeholder={disable ? "Lý do khóa" : "Lý do mở khóa"} required aria-label="Lý do" />
          <SubmitButton variant={disable ? "danger" : "secondary"} className="w-full">{disable ? "Khóa tài khoản" : "Mở khóa"}</SubmitButton>
        </form>
        <form action={setRole} className="space-y-2">
          <FormMessage state={rState} />
          <input type="hidden" name="user_id" value={user.id} />
          <input type="hidden" name="role" value={toAdmin ? "ADMIN" : "MEMBER"} />
          <Input name="reason" placeholder="Lý do đổi vai trò" required aria-label="Lý do đổi vai trò" />
          <SubmitButton variant="secondary" className="w-full">{toAdmin ? "Cấp quyền quản trị" : "Bỏ quyền quản trị"}</SubmitButton>
        </form>
        <form action={reset} className="space-y-2">
          <FormMessage state={pState} />
          {pState.ok && pState.data && <TempPassword username={user.username} password={pState.data.temp_password} />}
          <input type="hidden" name="user_id" value={user.id} />
          <p className="text-sm text-muted">Sinh mật khẩu tạm mới, bắt đổi khi đăng nhập.</p>
          <SubmitButton variant="secondary" className="w-full">Đặt lại mật khẩu</SubmitButton>
        </form>
      </div>
    </details>
  );
}
