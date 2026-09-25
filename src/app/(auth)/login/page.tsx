import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Đăng nhập" };

const ERRORS: Record<string, string> = {
  disabled: "Tài khoản đã bị khóa, liên hệ quản trị",
  noprofile: "Tài khoản chưa được thiết lập, liên hệ quản trị",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Đăng nhập</h1>
      <LoginForm next={next} initialError={error ? ERRORS[error] : undefined} />
      <p className="mt-4 text-sm text-muted">Tài khoản do quản trị cấp. Quên mật khẩu: nhờ quản trị đặt lại.</p>
    </>
  );
}
