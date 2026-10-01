"use client";

import { useState, useTransition } from "react";
import { quickPurchaseAction } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import { formatVnd, parseVnd } from "@/lib/money";
import { Button, Field, Input } from "@/components/ui";
import { FormMessage } from "@/components/form";

/** Mua sắm: số tiền + ghi chú → Lưu. Quỹ trả, chi phí tự chia đều cho mọi người (không hiện bảng chia). */
export function PurchaseQuickForm() {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const parsed = parseVnd(amount);
  const valid = parsed !== null && parsed > 0;

  function submit() {
    start(async () => {
      const r = await quickPurchaseAction({ idem_key: idemKey, amount_vnd: amount, note });
      setState({ ...r, data: undefined });
      if (r.ok) {
        setIdemKey(crypto.randomUUID());
        setAmount("");
        setNote("");
      }
    });
  }

  return (
    <div className="space-y-4">
      <FormMessage state={state} loginNext="/admin/fund?tab=buy" />
      <Field label="Số tiền (₫)" htmlFor="buy-amount" required error={state.fieldErrors?.amount_vnd} hint={valid ? formatVnd(parsed) : "VD: 250.000"}>
        <Input id="buy-amount" inputMode="numeric" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-lg font-semibold" />
      </Field>
      <Field label="Ghi chú" htmlFor="buy-note" required error={state.fieldErrors?.note} hint="Mua gì, ở đâu">
        <Input id="buy-note" maxLength={200} value={note} placeholder="vd: 1kg cà phê Robusta, sữa đặc" onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-sm text-muted">Tiền trừ vào quỹ, chi phí chia đều cho mọi người đang hoạt động.</p>
      <Button type="button" className="w-full" aria-busy={pending} disabled={pending || !valid || !note.trim()} onClick={submit}>
        {pending ? "Đang lưu…" : "Lưu"}
      </Button>
    </div>
  );
}
