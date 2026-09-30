"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

/** Lỗi tải file JS (thường do trang mở từ bản cũ trước khi deploy, hoặc mạng chập chờn) → cần tải lại cả trang */
const isChunkError = (e: Error) =>
  e.name === "ChunkLoadError" || /Loading chunk|Loading CSS chunk|dynamically imported module|Failed to fetch/i.test(e.message);

const RELOAD_KEY = "chunk-reload-at";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkError(error);

  useEffect(() => {
    if (!chunk) return;
    // Tự tải lại 1 lần; nếu vừa tải lại < 30s mà vẫn lỗi thì dừng, để người dùng bấm (tránh lặp vô hạn)
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* không có storage */ }
    if (Date.now() - last > 30_000) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* bỏ qua */ }
      window.location.reload();
    }
  }, [chunk]);

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{chunk ? "Ứng dụng vừa được cập nhật" : "Không tải được dữ liệu"}</h1>
      <p className="mt-2 text-muted">{chunk ? "Tải lại trang để dùng bản mới. Nếu vẫn lỗi, kiểm tra kết nối mạng." : error.message || "Có lỗi xảy ra."}</p>
      {error.digest && <p className="mt-1 text-sm text-muted">Mã lỗi: {error.digest}</p>}
      <Button className="mt-6" onClick={() => (chunk ? window.location.reload() : reset())}>{chunk ? "Tải lại trang" : "Thử lại"}</Button>
    </main>
  );
}
