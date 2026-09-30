"use client";

import { useState, useTransition } from "react";
import { reconcileNowAction } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import { Button } from "@/components/ui";
import { FormMessage } from "@/components/form";

export function ReconcileButton() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="secondary" aria-busy={pending} disabled={pending} onClick={() => start(async () => setState(await reconcileNowAction()))}>
        {pending ? "Đang đối soát…" : "Đối soát ngay"}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}
