"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postBulkDepositAction, type BulkDepositResult } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import { vnToday } from "@/lib/dates";
import { formatVnd, parseVnd } from "@/lib/money";
import { Button, Input, cx } from "@/components/ui";
import { FormMessage } from "@/components/form";

const QUICK_AMOUNTS = [50_000, 100_000, 200_000, 500_000];

/**
 * Ghi tiền vào: số tiền mỗi người → chọn người nộp → ghi chú → Lưu.
 * variant "page" (mobile, màn riêng): thanh Lưu cố định dưới, lưu xong về màn Quỹ.
 * variant "panel" (web, cạnh danh sách): lưu xong làm mới tại chỗ.
 */
export function DepositForm({ people, variant = "page" }: {
  people: { id: string; name: string; disabled?: boolean }[];
  variant?: "page" | "panel";
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("100000");
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<ActionState<BulkDepositResult>>({});
  const [pending, start] = useTransition();

  const parsed = parseVnd(amount);
  const valid = parsed !== null && parsed > 0;
  const active = people.filter((p) => !p.disabled);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? people.filter((p) => p.name.toLowerCase().includes(k)) : people;
  }, [people, q]);
  const everyone = active.length > 0 && active.every((p) => picked.includes(p.id));
  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  function submit() {
    start(async () => {
      const r = await postBulkDepositAction({ idem_key: idemKey, user_ids: picked, amount_vnd: amount, occurred_on: vnToday(), note });
      setState(r);
      if (r.ok) {
        if (variant === "page") { router.push("/me"); router.refresh(); return; }
        setIdemKey(crypto.randomUUID());
        setPicked([]);
        setNote("");
        router.refresh();
      } else if (r.data) {
        const failed = new Set(r.data.failed.map((f) => f.user_id));
        setPicked((xs) => xs.filter((x) => failed.has(x)));
      }
    });
  }

  const footer = (
    <>
      <p className="flex justify-between gap-2 text-sm text-muted" aria-live="polite">
        <span>{picked.length} người × {valid ? formatVnd(parsed) : "—"}</span>
        <strong className="num text-base text-ink">{valid ? formatVnd(parsed * picked.length) : "—"}</strong>
      </p>
      <Button type="button" className="min-h-12 w-full text-[17px] font-bold" aria-busy={pending}
        disabled={pending || !valid || picked.length === 0} onClick={submit}>
        {pending ? "Đang lưu…" : "Lưu"}
      </Button>
    </>
  );

  return (
    <div className={cx("space-y-5", variant === "page" && "pb-36 lg:pb-0")}>
      <FormMessage state={state} loginNext="/fund/in" />

      <section className="space-y-2.5">
        <label htmlFor="dep-amount" className="text-sm font-semibold">Mỗi người nộp</label>
        <div className="flex items-baseline gap-1.5 rounded-2xl border-2 border-brand bg-surface px-4 py-2.5">
          <input id="dep-amount" inputMode="numeric" autoComplete="off" value={valid ? parsed.toLocaleString("vi-VN") : amount}
            onChange={(e) => setAmount(e.target.value)}
            className="num w-full bg-transparent text-[28px] font-bold outline-none" />
          <span className="text-xl font-semibold text-muted">₫</span>
        </div>
        <div role="group" aria-label="Số tiền nhanh" className="grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map((a) => (
            <button key={a} type="button" onClick={() => setAmount(String(a))}
              className={cx("min-h-11 rounded-full border text-sm", parsed === a ? "border-brand bg-brand font-bold text-brand-ink" : "border-line bg-surface")}>
              {a / 1000}k
            </button>
          ))}
        </div>
        {state.fieldErrors?.amount_vnd && <p className="text-sm text-danger">{state.fieldErrors.amount_vnd}</p>}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Ai nộp? <span className="font-normal text-muted">· đã chọn {picked.length}</span></h2>
          <button type="button" onClick={() => setPicked(everyone ? [] : active.map((p) => p.id))}
            className="min-h-11 px-1 text-sm font-semibold text-brand">{everyone ? "Bỏ chọn" : "Chọn tất cả"}</button>
        </div>
        {people.length > 8 && <Input aria-label="Tìm người nộp" placeholder="Tìm tên…" value={q} onChange={(e) => setQ(e.target.value)} />}
        <ul aria-label="Chọn người nộp" className="max-h-[26rem] overflow-y-auto rounded-2xl border border-line bg-surface p-1">
          {shown.map((p) => {
            const on = picked.includes(p.id);
            return (
              <li key={p.id}>
                <label className={cx("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2.5", on ? "bg-brand-soft" : "hover:bg-bg", p.disabled && "opacity-60")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="size-5 shrink-0 accent-[#6f4428]" />
                  <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                    {p.name.trim().split(/\s+/).pop()?.[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="min-w-0 truncate">{p.name}</span>
                </label>
              </li>
            );
          })}
          {shown.length === 0 && <li className="p-3 text-sm text-muted">Không tìm thấy.</li>}
        </ul>
        {state.fieldErrors?.user_ids && <p className="text-sm text-danger">{state.fieldErrors.user_ids}</p>}
      </section>

      <section className="space-y-2">
        <label htmlFor="dep-note" className="text-sm font-semibold">Ghi chú</label>
        <Input id="dep-note" maxLength={500} value={note} placeholder="vd: Quỹ tháng 10" onChange={(e) => setNote(e.target.value)} />
      </section>

      {variant === "page" ? (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+max(32px,env(safe-area-inset-bottom)))] z-10 space-y-2.5 border-t border-line bg-surface px-4 py-3 lg:static lg:rounded-2xl lg:border lg:p-4">
          {footer}
        </div>
      ) : (
        <div className="space-y-2.5 border-t border-line pt-4">{footer}</div>
      )}
    </div>
  );
}
