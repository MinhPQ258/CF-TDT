import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatVnd } from "@/lib/money";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:brightness-110",
  secondary: "bg-surface text-ink border border-line hover:bg-brand-soft",
  danger: "bg-danger text-white hover:brightness-110",
  ghost: "text-brand hover:bg-brand-soft",
};

export const buttonClass = (variant: Variant = "primary", extra?: string) =>
  cx("inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-medium",
    "disabled:cursor-not-allowed disabled:opacity-60", VARIANT[variant], extra);

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function LinkButton({ variant = "secondary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface p-4 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Số tiền: có dấu trừ thật; tone theo dấu nhưng không chỉ dựa vào màu. */
export function Money({ value, sign, className, tone = true }: { value: number; sign?: boolean; className?: string; tone?: boolean }) {
  return (
    <span className={cx("num", tone && value < 0 && "text-danger", tone && value > 0 && sign && "text-ok", className)}>
      {formatVnd(value, { sign })}
    </span>
  );
}

type Tone = "neutral" | "ok" | "danger" | "warn" | "brand";
const TONE: Record<Tone, string> = {
  neutral: "bg-bg text-muted border-line",
  ok: "bg-ok-soft text-ok border-ok/20",
  danger: "bg-danger-soft text-danger border-danger/20",
  warn: "bg-warn-soft text-warn border-warn/20",
  brand: "bg-brand-soft text-brand border-brand/20",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-medium whitespace-nowrap", TONE[tone])}>{children}</span>;
}

export function Alert({ tone = "danger", title, children }: { tone?: Exclude<Tone, "neutral" | "brand"> | "brand"; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg border p-3", TONE[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx(title ? "mt-1" : "", "text-ink")}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "ok" }) {
  return (
    <div className={cx("rounded-xl border bg-surface p-4", tone === "danger" ? "border-danger/40" : "border-line")}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** Chữ dài: cắt dòng, bấm để xem đủ (không dựa vào hover) */
export function Truncate({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return <span className="text-muted">—</span>;
  if (text.length <= 32) return <span className={className}>{text}</span>;
  return (
    <details className={cx("group max-w-full", className)}>
      <summary className="cursor-pointer list-none truncate group-open:whitespace-normal">{text}</summary>
    </details>
  );
}

export function Field({ label, htmlFor, error, hint, children, required }: {
  label: string; htmlFor: string; error?: string; hint?: ReactNode; children: ReactNode; required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="font-medium">
        {label}{required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && <p id={`${htmlFor}-error`} className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export const inputClass = "min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base aria-[invalid=true]:border-danger";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputClass, "min-h-20", props.className)} />;
}

export function Pagination({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Phân trang">
      {page > 1 ? <LinkButton href={hrefFor(page - 1)}>← Trước</LinkButton> : <span />}
      <span className="text-muted">Trang {page}/{pages}</span>
      {page < pages ? <LinkButton href={hrefFor(page + 1)}>Sau →</LinkButton> : <span />}
    </nav>
  );
}

/** Bảng desktop; trên mobile các trang dùng danh sách card riêng */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-xl border border-line bg-surface", className)}>
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_thead]:bg-bg [&_tr]:border-b [&_tr]:border-line last:[&_tbody_tr]:border-0">
        {children}
      </table>
    </div>
  );
}
