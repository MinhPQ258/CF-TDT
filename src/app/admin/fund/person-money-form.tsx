"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { postPersonMoneyAction } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import type { EventResult } from "@/lib/types";
import { vnToday } from "@/lib/dates";
import { formatVnd, parseVnd } from "@/lib/money";
import { Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton, errProps, useIdempotencyKey, useResetOnSuccess } from "@/components/form";

export function PersonMoneyForm({ kind, people }: { kind: "DEPOSIT" | "REIMBURSEMENT"; people: { id: string; label: string; balance: number }[] }) {
  const [state, action] = useActionState<ActionState<EventResult>, FormData>(postPersonMoneyAction, {});
  const idemKey = useIdempotencyKey(state);
  const ref = useResetOnSuccess(state);
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const person = people.find((p) => p.id === userId);
  const parsed = parseVnd(amount);

  return (
    <form ref={ref} action={action} className="space-y-3" noValidate onReset={() => { setUserId(""); setAmount(""); }}>
      <FormMessage state={state} loginNext={`/admin/fund?form=${kind}`} />
      {state.ok && state.data && <Link href={`/admin/fund/${state.data.event_id}`} className="text-sm text-brand underline">Xem giao dịch vừa ghi</Link>}
      <input type="hidden" name="idem_key" value={idemKey} />
      <input type="hidden" name="kind" value={kind} />
      <Field label={kind === "DEPOSIT" ? "Người nộp" : "Người nhận hoàn"} htmlFor="user_id" error={state.fieldErrors?.user_id} required
        hint={person ? `Số dư hiện tại: ${formatVnd(person.balance, { sign: true })}` : undefined}>
        <Select id="user_id" name="user_id" value={userId} onChange={(e) => setUserId(e.target.value)} required {...errProps(state, "user_id")}>
          <option value="">— Chọn —</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </Field>
      <Field label="Số tiền (₫)" htmlFor="amount_vnd" error={state.fieldErrors?.amount_vnd} required
        hint={parsed && parsed > 0 ? formatVnd(parsed) : "VD: 30.000"}>
        <Input id="amount_vnd" name="amount_vnd" inputMode="numeric" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} required {...errProps(state, "amount_vnd")} />
      </Field>
      <Field label="Ngày thực nhận/trả" htmlFor="occurred_on" error={state.fieldErrors?.occurred_on} required>
        <Input id="occurred_on" name="occurred_on" type="date" max={vnToday()} defaultValue={vnToday()} required {...errProps(state, "occurred_on")} />
      </Field>
      <Field label="Mã chứng từ" htmlFor="external_ref" error={state.fieldErrors?.external_ref} hint="Tùy chọn, VD mã chuyển khoản. Không được trùng.">
        <Input id="external_ref" name="external_ref" maxLength={64} {...errProps(state, "external_ref")} />
      </Field>
      <Field label="Ghi chú" htmlFor="note">
        <Input id="note" name="note" maxLength={500} />
      </Field>
      <SubmitButton className="w-full" pendingText="Đang ghi…">{kind === "DEPOSIT" ? "Ghi tiền nộp" : "Ghi hoàn tiền"}</SubmitButton>
    </form>
  );
}
