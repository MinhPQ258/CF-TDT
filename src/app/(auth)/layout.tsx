export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-2xl font-bold text-brand">Coffee TDT</p>
        <div className="rounded-xl border border-line bg-surface p-5 sm:p-6">{children}</div>
      </div>
    </main>
  );
}
