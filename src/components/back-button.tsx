"use client";

import { useRouter } from "next/navigation";

/**
 * Nút quay lại cạnh tiêu đề màn con. Đến từ trang khác trong app → quay đúng trang trước (giữ bộ lọc, vị trí cuộn);
 * mở thẳng bằng link / tab mới → về trang cha `fallback`.
 */
export function BackButton({ fallback, label = "Quay lại" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <a
      href={fallback}
      aria-label={label}
      title={label}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // mở tab mới: để trình duyệt xử lý
        e.preventDefault();
        let sameOrigin = false;
        try {
          sameOrigin = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin;
        } catch {
          sameOrigin = false;
        }
        if (sameOrigin && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-brand-soft"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </a>
  );
}
