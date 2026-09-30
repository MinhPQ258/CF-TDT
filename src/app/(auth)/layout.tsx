export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo tĩnh, không cần tối ưu ảnh */}
        <img src="/logo.webp" alt="The 12A Coffee" width={160} height={160} className="mx-auto mb-4 size-40 rounded-full" />
        <div className="rounded-xl border border-line bg-surface p-5 sm:p-6">{children}</div>
      </div>
    </main>
  );
}
