"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Không tải được dữ liệu</h1>
      <p className="mt-2 text-muted">{error.message || "Có lỗi xảy ra."}</p>
      {error.digest && <p className="mt-1 text-sm text-muted">Mã lỗi: {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>Thử lại</Button>
    </main>
  );
}
