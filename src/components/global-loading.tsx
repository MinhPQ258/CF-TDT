"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Loading phủ toàn màn hình khi bấm nút:
 *  - nút đang chờ server: bất kỳ phần tử nào có aria-busy="true" (SubmitButton, nút dùng useTransition)
 *  - bấm link nội bộ sang trang khác: tới khi URL mới hiển thị
 * Chỉ hiện nếu chờ > 150ms để thao tác nhanh không nháy màn hình.
 */
export function GlobalLoading() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [nav, setNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  // Trang mới đã hiển thị → tắt loading điều hướng
  useEffect(() => { setNav(false); }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
      if (u.pathname === location.pathname && u.search === location.search) return; // chỉ đổi #hash / cùng trang
      setNav(true);
    };
    // capture: chạy trước khi Next <Link> chặn sự kiện để tự điều hướng
    document.addEventListener("click", onClick, true);
    const onPop = () => setNav(true); // nút back của trình duyệt
    window.addEventListener("popstate", onPop);
    return () => { document.removeEventListener("click", onClick, true); window.removeEventListener("popstate", onPop); };
  }, []);

  useEffect(() => {
    const check = () => setBusy(document.querySelector('[aria-busy="true"]') !== null);
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy"] });
    check();
    return () => mo.disconnect();
  }, []);

  const active = nav || busy;
  useEffect(() => {
    if (!active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 150);
    const safety = setTimeout(() => setNav(false), 15_000); // phòng khi điều hướng không đổi URL
    return () => { clearTimeout(t); clearTimeout(safety); };
  }, [active]);

  if (!show) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/20 backdrop-blur-[1px]">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface px-6 py-5 shadow-lg">
        <span aria-hidden className="size-9 animate-spin rounded-full border-4 border-brand-soft border-t-brand" />
        <span className="text-sm font-medium">Đang xử lý…</span>
      </div>
    </div>
  );
}
