"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Chip chọn (pill 44px). Chọn 1: role="radio"; chọn nhiều: aria-pressed + dấu ✓. */
export function Chip({ selected, onClick, children, multi, disabled }: {
  selected: boolean; onClick: () => void; children: ReactNode; multi?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={multi ? undefined : "radio"}
      aria-checked={multi ? undefined : selected}
      aria-pressed={multi ? selected : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cx("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] disabled:opacity-50",
        selected ? "border-brand bg-brand font-semibold text-brand-ink" : "border-line bg-surface font-medium text-ink hover:border-brand/50")}
    >
      {multi && selected && (
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7" /></svg>
      )}
      {children}
    </button>
  );
}

/** Nút phân đoạn lớn (Có uống / Không uống) */
export function Segment({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick}
      className={cx("min-h-12 rounded-[10px] text-base", selected ? "border-2 border-brand bg-brand-soft font-bold text-brand" : "border border-line bg-surface font-medium")}>
      {children}
    </button>
  );
}

export function Stepper({ value, onChange, min = 1, max = 20, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label: string;
}) {
  return (
    <div className="flex items-center rounded-full border border-line bg-surface" role="group" aria-label={label}>
      <button type="button" aria-label={`Bớt 1 (${label})`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}
        className="size-11 text-2xl leading-none text-brand disabled:opacity-30">−</button>
      <span className="num min-w-7 text-center text-lg font-bold" aria-live="polite">{value}</span>
      <button type="button" aria-label={`Thêm 1 (${label})`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}
        className="size-11 text-2xl leading-none text-brand disabled:opacity-30">+</button>
    </div>
  );
}

/** "còn 42 phút" / "còn 1 giờ 5 phút" — cập nhật mỗi 30 giây */
export function Countdown({ to, prefix = "còn" }: { to: string; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.round((new Date(to).getTime() - now) / 60_000));
  if (mins <= 0) return <span>đã hết giờ</span>;
  const h = Math.floor(mins / 60);
  return <span>{prefix} {h > 0 ? `${h} giờ ${mins % 60} phút` : `${mins} phút`}</span>;
}
