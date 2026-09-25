"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { postGiftAction, previewGiftAction } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import type { EventResult, GiftPreview } from "@/lib/types";
import { vnToday } from "@/lib/dates";
import { formatVnd, parseVnd } from "@/lib/money";
import { Button, Field, Input } from "@/components/ui";
import { FormMessage } from "@/components/form";
import { AllocationTable } from "@/components/allocation-table";
import { SplitExplanation } from "@/components/purchase-bits";

/** Tiền cho thêm: luôn chia đều (quyết định 2A). Xem trước phân bổ → xác nhận. */
export function GiftForm() {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(vnToday());
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<GiftPreview | null>(null);
  const [state, setState] = useState<ActionState<EventResult>>({});
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const parsed = parseVnd(amount);

  const invalidate = () => setPreview(null);

  return (
    <div className="space-y-3">
      <FormMessage state={state} loginNext="/admin/fund?form=GIFT" />
      {state.ok && state.data && <Link href={`/admin/fund/${state.data.event_id}`} className="text-sm text-brand underline">Xem giao dịch vừa ghi</Link>}
      <Field label="Số tiền được cho (₫)" htmlFor="gift-amount" error={state.fieldErrors?.amount_vnd} required hint={parsed && parsed > 0 ? formatVnd(parsed) : undefined}>
        <Input id="gift-amount" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); invalidate(); }} />
      </Field>
      <Field label="Ngày nhận" htmlFor="gift-date" error={state.fieldErrors?.occurred_on} required>
        <Input id="gift-date" type="date" max={vnToday()} value={date} onChange={(e) => { setDate(e.target.value); invalidate(); }} />
      </Field>
      <Field label="Mã chứng từ" htmlFor="gift-ref"><Input id="gift-ref" maxLength={64} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <Field label="Ghi chú" htmlFor="gift-note"><Input id="gift-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: sếp cho thêm" /></Field>

      {!preview ? (
        <Button type="button" className="w-full" disabled={pending} onClick={() => start(async () => {
          const r = await previewGiftAction({ amount_vnd: amount, occurred_on: date });
          setState(r.ok ? {} : { ...r, data: undefined });
          setPreview(r.ok && r.data ? r.data : null);
        })}>{pending ? "Đang tính…" : "Xem trước phân bổ"}</Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <SplitExplanation total={preview.total_vnd} split={preview.split} />
          <AllocationTable members={preview.members} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={invalidate} disabled={pending}>Sửa</Button>
            <Button type="button" className="flex-1" disabled={pending} onClick={() => start(async () => {
              const r = await postGiftAction({ idem_key: idemKey, amount_vnd: amount, occurred_on: date, preview_hash: preview.preview_hash, external_ref: ref, note });
              setState(r);
              if (r.ok) {
                setIdemKey(crypto.randomUUID());
                setPreview(null); setAmount(""); setRef(""); setNote("");
              } else if (r.code === "MEMBERSHIP_CHANGED") {
                setPreview(null);
              }
            })}>{pending ? "Đang ghi…" : `Xác nhận ghi ${formatVnd(preview.total_vnd)}`}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
