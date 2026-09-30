"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export type IconName = "wallet" | "cup" | "receipt" | "chart" | "users" | "user" | "table" | "file" | "pulse" | "key" | "plus" | "gear";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const PATHS: Record<IconName, string> = {
  wallet: "M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Zm0 0 2-3h11l2 3M16 13.5h2",
  cup: "M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V8Zm13 1h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h3",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74",
  user: "M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  table: "M3 5h18v14H3V5Zm0 5h18M9 5v14",
  file: "M14 3H6v18h12V7l-4-4Zm0 0v4h4M9 13l2 2 4-4",
  pulse: "M3 12h4l2-6 4 12 2-6h6",
  key: "M15 7a4 4 0 1 1-3.87 5H9v2H7v2H4v-3l6.13-6.13A4 4 0 0 1 15 7Z",
  plus: "M12 5v14M5 12h14",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.3 7.3 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function NavLinks({ items, variant }: { items: NavItem[]; variant: "side" | "bottom" }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (variant === "bottom") {
    return (
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => (
          <li key={it.href}>
            <Link href={it.href} aria-current={isActive(it.href) ? "page" : undefined}
              className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs", isActive(it.href) ? "text-brand font-semibold" : "text-muted")}>
              <Icon name={it.icon} />
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-0.5">
      {items.map((it) => (
        <li key={it.href}>
          <Link href={it.href} aria-current={isActive(it.href) ? "page" : undefined}
            className={cx("flex min-h-11 items-center gap-3 rounded-lg px-3", isActive(it.href) ? "bg-brand-soft font-semibold text-brand" : "hover:bg-bg")}>
            <Icon name={it.icon} />
            {it.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface TabItem extends NavItem {
  /** các tiền tố đường dẫn làm tab này sáng (mặc định: href) */
  match?: string[];
  /** nút giữa nổi bật (＋ Tạo đợt vote) */
  primary?: boolean;
}

/** Thanh tab dưới (mobile): 5 mục, mục giữa là nút tròn nổi bật */
export function BottomTabs({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  // Tab sáng = tab có tiền tố khớp dài nhất (vd /votes/new thuộc nút ＋, không thuộc Vote)
  const score = (it: TabItem) => Math.max(-1, ...(it.match ?? [it.href]).map((m) =>
    (m === "/" ? pathname === "/" : pathname === m || pathname.startsWith(`${m}/`)) ? m.length : -1));
  const best = Math.max(...items.map(score));
  const active = (it: TabItem) => best >= 0 && score(it) === best;
  return (
    <ul className="grid grid-cols-5 items-end">
      {items.map((it) => {
        const on = active(it);
        if (it.primary) {
          return (
            <li key={it.href} className="flex justify-center">
              <Link href={it.href} aria-label={it.label} aria-current={on ? "page" : undefined}
                className="-mt-5 flex size-14 items-center justify-center rounded-full bg-brand text-brand-ink shadow-lg ring-4 ring-surface">
                <Icon name={it.icon} />
              </Link>
            </li>
          );
        }
        return (
          <li key={it.href}>
            <Link href={it.href} aria-current={on ? "page" : undefined}
              className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs", on ? "font-semibold text-brand" : "text-muted")}>
              <Icon name={it.icon} />
              {it.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
