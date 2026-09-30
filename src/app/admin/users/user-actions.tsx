"use client";

import { useActionState } from "react";
import { resetPasswordAction, setUserRoleAction, setUserStatusAction } from "@/features/users/actions";
import type { ActionState } from "@/lib/action";
import type { AdminUser } from "@/lib/types";
import { FormMessage, SubmitButton } from "@/components/form";

/** Thao tác trên từng người dùng: Cấp lại mật khẩu (về mặc định), Khóa / Mở khóa, đổi vai trò */
export function UserActions({ user, defaultPassword }: { user: AdminUser; defaultPassword: string }) {
  const [sState, setStatus] = useActionState<ActionState, FormData>(setUserStatusAction, {});
  const [rState, setRole] = useActionState<ActionState, FormData>(setUserRoleAction, {});
  const [pState, reset] = useActionState<ActionState<{ temp_password: string }>, FormData>(resetPasswordAction, {});
  const disable = user.status === "ACTIVE";
  const toAdmin = user.role === "MEMBER";
  const confirmSubmit = (msg: string) => (e: React.FormEvent) => { if (!window.confirm(msg)) e.preventDefault(); };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={reset} onSubmit={confirmSubmit(`Đặt mật khẩu của ${user.username} về ${defaultPassword}?`)}>
          <input type="hidden" name="user_id" value={user.id} />
          <SubmitButton variant="secondary" pendingText="Đang đặt lại…">Cấp lại mật khẩu</SubmitButton>
        </form>
        <form action={setStatus} onSubmit={disable ? confirmSubmit(`Khóa ${user.username}? Người này sẽ bị đăng xuất và không được chia quỹ.`) : undefined}>
          <input type="hidden" name="user_id" value={user.id} />
          <input type="hidden" name="status" value={disable ? "DISABLED" : "ACTIVE"} />
          <SubmitButton variant={disable ? "danger" : "secondary"} pendingText="Đang lưu…">{disable ? "Khóa" : "Mở khóa"}</SubmitButton>
        </form>
        <form action={setRole} onSubmit={confirmSubmit(toAdmin ? `Cấp quyền quản trị cho ${user.username}?` : `Bỏ quyền quản trị của ${user.username}?`)}>
          <input type="hidden" name="user_id" value={user.id} />
          <input type="hidden" name="role" value={toAdmin ? "ADMIN" : "MEMBER"} />
          <SubmitButton variant="secondary" pendingText="Đang lưu…">{toAdmin ? "Cấp quyền quản trị" : "Bỏ quyền quản trị"}</SubmitButton>
        </form>
      </div>
      <FormMessage state={pState} />
      <FormMessage state={sState} />
      <FormMessage state={rState} />
    </div>
  );
}
