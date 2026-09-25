"use client";

import { useActionState, useState } from "react";
import { castVoteAction, withdrawVoteAction } from "@/features/votes/actions";
import { initialState } from "@/lib/action";
import { COFFEE_TYPE_LABEL } from "@/lib/labels";
import type { CoffeeType, VoteSession } from "@/lib/types";
import { Field, Input, cx } from "@/components/ui";
import { FormMessage, SubmitButton, errProps } from "@/components/form";

export function VoteForm({ sessionId, myVote }: { sessionId: string; myVote: VoteSession["my_vote"] }) {
  const [state, action] = useActionState(castVoteAction, initialState);
  const [wState, withdraw] = useActionState(withdrawVoteAction, initialState);
  const [choice, setChoice] = useState<"YES" | "NO">(myVote?.choice ?? "YES");
  const types: CoffeeType[] = ["MACHINE", "PHIN", "UNDECIDED"];

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <FormMessage state={state} loginNext={`/votes/${sessionId}`} />
        <input type="hidden" name="session_id" value={sessionId} />
        <fieldset>
          <legend className="mb-1 font-medium">Bạn có uống không?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["YES", "NO"] as const).map((c) => (
              <label key={c} className={cx("flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3",
                choice === c ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line")}>
                <input type="radio" name="choice" value={c} checked={choice === c} onChange={() => setChoice(c)} className="sr-only" />
                {c === "YES" ? "Có uống" : "Không"}
              </label>
            ))}
          </div>
        </fieldset>
        {choice === "YES" && (
          <>
            <fieldset>
              <legend className="mb-1 font-medium">Pha bằng</legend>
              <div className="grid grid-cols-3 gap-2">
                {types.map((t) => (
                  <label key={t} className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-2 has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:font-semibold">
                    <input type="radio" name="coffee_type" value={t} defaultChecked={(myVote?.coffee_type ?? "UNDECIDED") === t} className="sr-only" />
                    {COFFEE_TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Số cốc dự kiến" htmlFor="cups" error={state.fieldErrors?.cups}>
              <Input id="cups" name="cups" type="number" inputMode="numeric" min={1} max={20} defaultValue={myVote?.cups ?? 1} required {...errProps(state, "cups")} />
            </Field>
          </>
        )}
        <Field label="Ghi chú" htmlFor="note" error={state.fieldErrors?.note}>
          <Input id="note" name="note" maxLength={200} defaultValue={myVote?.note ?? ""} placeholder="Ít đường, đá riêng…" />
        </Field>
        <SubmitButton className="w-full" pendingText="Đang lưu…">{myVote ? "Cập nhật phiếu" : "Gửi phiếu"}</SubmitButton>
      </form>
      {myVote && (
        <form action={withdraw}>
          <FormMessage state={wState} />
          <input type="hidden" name="session_id" value={sessionId} />
          <SubmitButton variant="secondary" className="w-full" pendingText="Đang rút…">Rút phiếu</SubmitButton>
        </form>
      )}
    </div>
  );
}
