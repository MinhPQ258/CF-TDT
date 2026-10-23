"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetDutyHistoryAction } from "@/features/duty/actions";
import type { ActionState } from "@/lib/action";
import { FormMessage } from "@/components/form";

/** Nút Reset lịch sử quay — chỉ render cho người có quyền Trực nhật (server cũng chặn) */
export function ResetHistoryButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" disabled={disabled || pending} aria-busy={pending}
        onClick={() => {
          if (!window.confirm("Reset lịch sử quay?\nNgười trong lịch sử sẽ trở lại vòng quay và lịch sử bị xoá. Không hoàn tác được.")) return;
          start(async () => {
            const r = await resetDutyHistoryAction();
            setState({ ...r, data: undefined });
            if (r.ok) router.refresh();
          });
        }}
        className="flex min-h-11 items-center gap-1.5 whitespace-nowrap px-1 text-sm font-semibold text-danger disabled:opacity-40">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
        </svg>
        {pending ? "Đang reset…" : "Reset lịch sử"}
      </button>
      {state.at && <div className="basis-full"><FormMessage state={state} /></div>}
    </>
  );
}
