"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawVoteAction } from "@/features/votes/actions";
import { Button } from "@/components/ui";

/** Rút vote — không cần hộp xác nhận vì vote lại được tới giờ chốt */
export function WithdrawButton({ sessionId, afterHref }: { sessionId: string; afterHref: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div>
      <Button type="button" variant="secondary" className="w-full text-danger" disabled={pending} onClick={() => start(async () => {
        const r = await withdrawVoteAction({ session_id: sessionId });
        if (r.ok) {
          router.replace(afterHref);
          router.refresh();
        } else setError(r.message ?? "Không rút được vote");
      })}>{pending ? "Đang rút…" : "Rút vote"}</Button>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
