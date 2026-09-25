"use client";

import { useActionState } from "react";
import { createVoteSessionAction, manageVoteSessionAction } from "@/features/votes/actions";
import type { ActionState } from "@/lib/action";
import type { VoteSession } from "@/lib/types";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, errProps, useResetOnSuccess } from "@/components/form";

export function CreateSessionForm({ today }: { today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(createVoteSessionAction, {});
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <FormMessage state={state} loginNext="/admin/votes" />
      <Field label="Tên đợt" htmlFor="name" error={state.fieldErrors?.name} required>
        <Input id="name" name="name" maxLength={100} placeholder="VD: Pha sáng / Pha thêm chiều" required {...errProps(state, "name")} />
      </Field>
      <Field label="Ngày pha" htmlFor="service_date" error={state.fieldErrors?.service_date} required>
        <Input id="service_date" name="service_date" type="date" min={today} defaultValue={today} required />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Mở" htmlFor="opens_time" error={state.fieldErrors?.opens_time} required>
          <Input id="opens_time" name="opens_time" type="time" defaultValue="07:30" required />
        </Field>
        <Field label="Chốt" htmlFor="cutoff_time" error={state.fieldErrors?.cutoff_time} required>
          <Input id="cutoff_time" name="cutoff_time" type="time" defaultValue="09:00" required {...errProps(state, "cutoff_time")} />
        </Field>
        <Field label="Pha" htmlFor="brew_time">
          <Input id="brew_time" name="brew_time" type="time" defaultValue="09:15" />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" name="publish" defaultChecked className="size-5" /> Đăng ngay (bỏ chọn = lưu nháp)
      </label>
      <p className="text-sm text-muted">Giờ theo múi giờ Việt Nam.</p>
      <SubmitButton className="w-full" pendingText="Đang tạo…">Tạo đợt</SubmitButton>
    </form>
  );
}

export function SessionActions({ session }: { session: VoteSession }) {
  const [state, action] = useActionState<ActionState, FormData>(manageVoteSessionAction, {});
  const s = session;
  if (s.state === "CLOSED" || s.state === "CANCELLED") return null;
  return (
    <div className="mt-2 space-y-2">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {s.state === "DRAFT" && (
          <form action={action}><input type="hidden" name="session_id" value={s.id} /><input type="hidden" name="op" value="publish" /><SubmitButton variant="secondary">Đăng</SubmitButton></form>
        )}
        {(s.state === "OPEN" || s.state === "UPCOMING") && (
          <form action={action}><input type="hidden" name="session_id" value={s.id} /><input type="hidden" name="op" value="close" /><SubmitButton variant="secondary">Chốt sớm</SubmitButton></form>
        )}
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center px-2 text-danger">Hủy đợt…</summary>
          <form action={action} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="session_id" value={s.id} /><input type="hidden" name="op" value="cancel" />
            <Input name="reason" placeholder="Lý do hủy" required aria-label="Lý do hủy" className="w-56" />
            <SubmitButton variant="danger">Xác nhận hủy</SubmitButton>
          </form>
        </details>
      </div>
    </div>
  );
}
