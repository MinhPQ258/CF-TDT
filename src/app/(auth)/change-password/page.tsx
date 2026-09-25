import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { Alert } from "@/components/ui";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Đổi mật khẩu" };

export default async function ChangePasswordPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Đổi mật khẩu</h1>
      <p className="mb-4 text-muted">{me.display_name} ({me.username})</p>
      {me.must_change_password && (
        <div className="mb-4">
          <Alert tone="warn" title="Bắt buộc đổi mật khẩu">Bạn đang dùng mật khẩu tạm do quản trị cấp. Đổi mật khẩu để tiếp tục.</Alert>
        </div>
      )}
      <ChangePasswordForm />
    </>
  );
}
