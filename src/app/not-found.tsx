import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <h1 className="mt-2 text-xl font-semibold">Không tìm thấy trang</h1>
      <LinkButton href="/" className="mt-6">Về trang chủ</LinkButton>
    </main>
  );
}
