"use client";

import { useMemo, useState, useTransition } from "react";
import { postBulkDepositAction, type BulkDepositResult } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import { vnToday } from "@/lib/dates";
import { formatVnd, parseVnd } from "@/lib/money";
import { Button, Field, Input, cx } from "@/components/ui";
import { FormMessage } from "@/components/form";

const QUICK_AMOUNTS = [50_000, 100_000, 200_000, 500_000];

/** Nộp quỹ nhanh: nhập số tiền → chọn một hoặc nhiều người nộp (mỗi người cùng số tiền) */
export function DepositForm({ people }: { people: { id: string; label: string; disabled?: boolean }[] }) {
  const [amount, setAmount] = useState("");
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
    return k ? people.filter((p) => p.label.toLowerCase().includes(k)) : people;
  }, [people, q]);

  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  function submit() {
    start(async () => {
      const r = await postBulkDepositAction({ idem_key: idemKey, user_ids: picked, amount_vnd: amount, occurred_on: vnToday(), note });
      setState(r);
      if (r.ok) {
        setIdemKey(crypto.randomUUID());
        setPicked([]);
        setAmount("");
        setNote("");
      } else if (r.data) {
        // Giữ lại người lỗi để thử lại; người đã ghi thì bỏ chọn
        const failed = new Set(r.data.failed.map((f) => f.user_id));
        setPicked((xs) => xs.filter((x) => failed.has(x)));
      }
    });
  }

  return (
    <div className="space-y-4">
      <FormMessage state={state} loginNext="/admin/fund?tab=in" />

      <Field label="Số tiền mỗi người (₫)" htmlFor="dep-amount" required error={state.fieldErrors?.amount_vnd}
        hint={valid ? formatVnd(parsed) : "VD: 100.000"}>
        <Input id="dep-amount" inputMode="numeric" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="text-lg font-semibold" />
      </Field>
      <div className="-mt-2 flex flex-wrap gap-1.5">
        {QUICK_AMOUNTS.map((a) => (
          <button key={a} type="button" onClick={() => setAmount(String(a))}
            className={cx("min-h-9 rounded-full border px-3 text-sm", parsed === a ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line bg-surface")}>
            {a / 1000}k
          </button>
        ))}
      </div>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Người nộp <span className="text-danger">*</span></h3>
          <span className="text-sm text-muted">Đã chọn {picked.length}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-sm">
          <button type="button" className="min-h-9 rounded-md px-2 text-brand underline" onClick={() => setPicked(active.map((p) => p.id))}>Chọn tất cả</button>
          {picked.length > 0 && <button type="button" className="min-h-9 rounded-md px-2 text-muted underline" onClick={() => setPicked([])}>Bỏ chọn</button>}
        </div>
        {people.length > 8 && <Input aria-label="Tìm người nộp" placeholder="Tìm tên…" value={q} onChange={(e) => setQ(e.target.value)} />}
        <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-line p-1" aria-label="Chọn người nộp">
          {shown.map((p) => {
            const on = picked.includes(p.id);
            return (
              <li key={p.id}>
                <label className={cx("flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2", on ? "bg-brand-soft" : "hover:bg-bg", p.disabled && "opacity-60")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="size-5 shrink-0 accent-[#6f4428]" />
                  <span className="min-w-0 flex-grow truncate">{p.label}</span>
                </label>
              </li>
            );
          })}
          {shown.length === 0 && <li className="p-2 text-sm text-muted">Không tìm thấy.</li>}
        </ul>
        {state.fieldErrors?.user_ids && <p className="text-sm text-danger">{state.fieldErrors.user_ids}</p>}
      </section>

      <Field label="Ghi chú" htmlFor="dep-note">
        <Input id="dep-note" maxLength={500} value={note} placeholder="vd: Quỹ tháng 10" onChange={(e) => setNote(e.target.value)} />
      </Field>

      {valid && picked.length > 0 && (
        <p className="text-sm text-muted" aria-live="polite">{picked.length} người × {formatVnd(parsed)} = <strong className="text-ink">{formatVnd(parsed * picked.length)}</strong></p>
      )}

      <Button type="button" className="w-full" aria-busy={pending} disabled={pending || !valid || picked.length === 0} onClick={submit}>
        {pending ? "Đang lưu…" : "Lưu"}
      </Button>
    </div>
  );
}
