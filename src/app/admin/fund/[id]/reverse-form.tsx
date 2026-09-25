"use client";

import { useActionState } from "react";
import Link from "next/link";
import { reverseEventAction } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import type { EventResult } from "@/lib/types";
import { Field, Textarea } from "@/components/ui";
import { FormMessage, SubmitButton, errProps, useIdempotencyKey } from "@/components/form";

export function ReverseForm({ eventId, isReversal }: { eventId: string; isReversal: boolean }) {
  const [state, action] = useActionState<ActionState<EventResult>, FormData>(reverseEventAction, {});
  const idemKey = useIdempotencyKey(state);
  if (state.ok && state.data) {
    return (
      <div className="space-y-2">
        <FormMessage state={state} />
        <Link className="text-brand underline" href={`/admin/fund/${state.data.event_id}`}>Xem giao dịch đảo</Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} loginNext={`/admin/fund/${eventId}`} />
      <p className="text-sm text-muted">
        {isReversal
          ? "Đảo một giao dịch đảo = khôi phục giao dịch gốc."
          : "Tạo giao dịch mới ngược dấu từng dòng gốc (cùng người, cùng loại). Không chia lại theo thành viên hiện tại. Ghi ngày hôm nay."}
      </p>
      <input type="hidden" name="idem_key" value={idemKey} />
      <input type="hidden" name="event_id" value={eventId} />
      <Field label="Lý do đảo" htmlFor="reason" error={state.fieldErrors?.reason} required>
        <Textarea id="reason" name="reason" maxLength={500} required {...errProps(state, "reason")} />
      </Field>
      <SubmitButton variant="danger" className="w-full" pendingText="Đang đảo…">Đảo giao dịch</SubmitButton>
    </form>
  );
}
