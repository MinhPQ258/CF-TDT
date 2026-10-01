import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { Alert } from "@/components/ui";
import { ChangePasswordForm } from "./change-password-form";
import { logoutAction } from "@/features/auth/actions";
import { BackButton } from "@/components/back-button";
import { can } from "@/lib/permissions";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Đổi mật khẩu" };

export default async function ChangePasswordPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  return (
    <>
      <div className="mb-1 flex items-center gap-1">
        {!(me.must_change_password && serverEnv.forcePasswordChange()) && (
          <BackButton fallback={can(me, "votes.manage") ? "/admin/votes" : "/"} />
        )}
        <h1 className="text-xl font-semibold">Đổi mật khẩu</h1>
      </div>
      <p className="mb-4 text-muted">{me.display_name} ({me.username})</p>
      {me.must_change_password && serverEnv.forcePasswordChange() && (
        <div className="mb-4">
          <Alert tone="warn" title="Bắt buộc đổi mật khẩu">Bạn đang dùng mật khẩu tạm do quản trị cấp. Đổi mật khẩu để tiếp tục.</Alert>
        </div>
      )}
      <ChangePasswordForm />
      <form action={logoutAction} className="mt-4 text-center">
        <button className="inline-flex min-h-11 items-center text-sm text-muted underline">Không phải bạn? Đăng xuất</button>
      </form>
    </>
  );
}
