import { LinkButton } from "@/components/ui";

export const metadata = { title: "Không có quyền" };

export default function ForbiddenPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-5xl font-bold text-brand">403</p>
      <h1 className="mt-2 text-xl font-semibold">Bạn không có quyền truy cập trang này</h1>
      <p className="mt-2 text-muted">Trang quản trị chỉ dành cho tài khoản ADMIN.</p>
      <LinkButton href="/me" className="mt-6">Về trang của tôi</LinkButton>
    </main>
  );
}
