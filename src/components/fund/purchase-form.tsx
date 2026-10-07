"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickPurchaseAction } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import { addDays, vnToday } from "@/lib/dates";
import { formatVnd, parseVnd } from "@/lib/money";
import { Button, Input, cx } from "@/components/ui";
import { FormMessage } from "@/components/form";

const QUICK_ITEMS = ["Cà phê", "Sữa đặc", "Sữa tươi", "Đường", "Đá", "Ly giấy"];
type Day = "today" | "yesterday" | "other";

/**
 * Ghi mua sắm: số tiền đã chi → mua gì → ngày mua → Lưu. Tiền lấy từ quỹ, chi phí chia đều tự động.
 * variant như DepositForm.
 */
export function PurchaseForm({ cashBalance, variant = "page" }: { cashBalance: number; variant?: "page" | "panel" }) {
  const router = useRouter();
  const today = vnToday();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState<Day>("today");
  const [other, setOther] = useState(addDays(today, -2));
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  const parsed = parseVnd(amount);
  const valid = parsed !== null && parsed > 0;
  const date = day === "today" ? today : day === "yesterday" ? addDays(today, -1) : other;
  const addItem = (x: string) => setNote((n) => (n.trim() ? `${n.trim()}, ${x.toLowerCase()}` : x));

  function submit() {
    start(async () => {
      const r = await quickPurchaseAction({ idem_key: idemKey, amount_vnd: amount, note, occurred_on: date });
      setState({ ...r, data: undefined });
      if (r.ok) {
        if (variant === "page") { router.push("/me"); router.refresh(); return; }
        setIdemKey(crypto.randomUUID());
        setAmount("");
        setNote("");
        setDay("today");
        router.refresh();
      }
    });
  }

  const days: { id: Day; label: string }[] = [{ id: "today", label: "Hôm nay" }, { id: "yesterday", label: "Hôm qua" }, { id: "other", label: "Ngày khác" }];
  const footer = (
    <Button type="button" className="min-h-12 w-full text-[17px] font-bold" aria-busy={pending}
      disabled={pending || !valid || !note.trim()} onClick={submit}>
      {pending ? "Đang lưu…" : "Lưu"}
    </Button>
  );

  return (
    <div className={cx("space-y-5", variant === "page" && "pb-28 lg:pb-0")}>
      <FormMessage state={state} loginNext="/fund/buy" />

      <section className="space-y-2.5">
        <label htmlFor="buy-amount" className="text-sm font-semibold">Số tiền đã chi</label>
        <div className="flex items-baseline gap-1.5 rounded-2xl border-2 border-brand bg-surface px-4 py-2.5">
          <input id="buy-amount" inputMode="numeric" autoComplete="off" placeholder="0" value={valid ? parsed.toLocaleString("vi-VN") : amount}
            onChange={(e) => setAmount(e.target.value)}
            className="num w-full bg-transparent text-[28px] font-bold outline-none placeholder:text-line" />
          <span className="text-xl font-semibold text-muted">₫</span>
        </div>
        {state.fieldErrors?.amount_vnd && <p className="text-sm text-danger">{state.fieldErrors.amount_vnd}</p>}
      </section>

      <section className="space-y-2.5">
        <label htmlFor="buy-note" className="text-sm font-semibold">Mua gì?</label>
        <textarea id="buy-note" rows={3} maxLength={200} value={note} placeholder="vd: Cà phê Robusta 1kg, 2 hộp sữa đặc"
          onChange={(e) => setNote(e.target.value)}
          className="w-full resize-none rounded-xl border border-line bg-surface px-3.5 py-3 leading-relaxed outline-none focus:border-brand" />
        <div role="group" aria-label="Thêm nhanh" className="flex flex-wrap gap-2">
          {QUICK_ITEMS.map((x) => (
            <button key={x} type="button" onClick={() => addItem(x)} className="min-h-10 rounded-full border border-line bg-surface px-3.5 text-sm hover:border-brand/50">+ {x}</button>
          ))}
        </div>
        {state.fieldErrors?.note && <p className="text-sm text-danger">{state.fieldErrors.note}</p>}
      </section>

      <section className="space-y-2">
        <span id="buy-day" className="text-sm font-semibold">Ngày mua</span>
        <div role="radiogroup" aria-labelledby="buy-day" className="grid grid-cols-3 gap-2">
          {days.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={day === d.id} onClick={() => setDay(d.id)}
              className={cx("min-h-11 rounded-xl border text-sm", day === d.id ? "border-brand bg-brand font-bold text-brand-ink" : "border-line bg-surface")}>
              {d.label}
            </button>
          ))}
        </div>
        {day === "other" && (
          <Input type="date" aria-label="Chọn ngày mua" max={today} value={other} onChange={(e) => setOther(e.target.value)} />
        )}
        {state.fieldErrors?.occurred_on && <p className="text-sm text-danger">{state.fieldErrors.occurred_on}</p>}
      </section>

      <p className="flex items-start gap-2.5 rounded-xl bg-brand-soft px-3.5 py-3 text-sm leading-relaxed">
        <svg viewBox="0 0 24 24" className="mt-0.5 size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
        <span>Tiền lấy từ quỹ.{valid && <> Quỹ còn sau khi lưu: <strong className={cx("num", cashBalance - parsed < 0 && "text-danger")}>{formatVnd(cashBalance - parsed)}</strong></>}</span>
      </p>

      {variant === "page" ? (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+max(32px,env(safe-area-inset-bottom)))] z-10 border-t border-line bg-surface px-4 py-3 lg:static lg:rounded-2xl lg:border lg:p-4">
          {footer}
        </div>
      ) : (
        <div className="border-t border-line pt-4">{footer}</div>
      )}
    </div>
  );
}
