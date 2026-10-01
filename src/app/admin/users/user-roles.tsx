"use client";

import { useState, useTransition } from "react";
import { setUserRolesAction } from "@/features/users/role-actions";
import type { ActionState } from "@/lib/action";
import { Button, cx } from "@/components/ui";
import { FormMessage } from "@/components/form";

/** Phân người dùng vào vai trò: bấm chip để chọn / bỏ, rồi Lưu */
export function UserRoles({ userId, roles, selected }: { userId: string; roles: { id: string; name: string }[]; selected: string[] }) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const dirty = picked.length !== selected.length || picked.some((x) => !selected.includes(x));

  if (roles.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Vai trò">
        <span className="mr-1 text-xs font-semibold uppercase text-muted">Vai trò</span>
        {roles.map((r) => {
          const on = picked.includes(r.id);
          return (
            <button key={r.id} type="button" aria-pressed={on} disabled={pending}
              onClick={() => setPicked((xs) => (on ? xs.filter((x) => x !== r.id) : [...xs, r.id]))}
              className={cx("min-h-9 rounded-full border px-3 text-sm", on ? "border-brand bg-brand font-semibold text-brand-ink" : "border-line bg-surface hover:border-brand/50")}>
              {r.name}
            </button>
          );
        })}
        {dirty && (
          <Button type="button" className="min-h-9 px-3 text-sm" disabled={pending} aria-busy={pending}
            onClick={() => start(async () => setState(await setUserRolesAction(userId, picked)))}>
            {pending ? "Đang lưu…" : "Lưu vai trò"}
          </Button>
        )}
      </div>
      <FormMessage state={state} />
    </div>
  );
}
