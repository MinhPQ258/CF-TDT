"use client";

import { useState, useTransition } from "react";
import { deleteRoleAction, saveRoleAction } from "@/features/users/role-actions";
import type { ActionState } from "@/lib/action";
import { PERMISSIONS } from "@/lib/permissions";
import type { RbacRole } from "@/lib/types";
import { Button, Field, Input, cx } from "@/components/ui";
import { FormMessage } from "@/components/form";

/** Tạo vai trò (role không truyền) hoặc sửa vai trò có sẵn */
export function RoleEditor({ role, onDone }: { role?: RbacRole; onDone?: () => void }) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const locked = role?.is_system ?? false;

  const toggle = (code: string) => setPerms((xs) => (xs.includes(code) ? xs.filter((x) => x !== code) : [...xs, code]));

  function save() {
    start(async () => {
      const r = await saveRoleAction({ role_id: role?.id ?? null, name, description, permissions: perms });
      setState(r);
      if (r.ok && !role) { setName(""); setDescription(""); setPerms([]); }
      if (r.ok) onDone?.();
    });
  }

  function remove() {
    if (!role || !window.confirm(`Xoá vai trò "${role.name}"? ${role.users.length} người đang có vai trò này sẽ mất các quyền của nó.`)) return;
    start(async () => setState(await deleteRoleAction(role.id)));
  }

  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <Field label="Tên vai trò" htmlFor={`rn-${role?.id ?? "new"}`} required error={state.fieldErrors?.name}>
        <Input id={`rn-${role?.id ?? "new"}`} value={name} maxLength={60} placeholder="vd: Thủ quỹ" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Mô tả" htmlFor={`rd-${role?.id ?? "new"}`}>
        <Input id={`rd-${role?.id ?? "new"}`} value={description} maxLength={300} placeholder="Tùy chọn" onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-medium">Quyền {locked && <span className="font-normal text-muted">· vai trò hệ thống luôn đủ quyền</span>}</legend>
        {PERMISSIONS.map((p) => {
          const on = perms.includes(p.code);
          return (
            <label key={p.code} className={cx("flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2", on ? "bg-brand-soft" : "hover:bg-bg", locked && "cursor-default opacity-80")}>
              <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(p.code)} className="mt-0.5 size-5 shrink-0 accent-[#6f4428]" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="block text-xs text-muted">{p.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={pending || !name.trim()} aria-busy={pending} className="min-w-28">
          {pending ? "Đang lưu…" : role ? "Lưu" : "Tạo vai trò"}
        </Button>
        {role && !role.is_system && (
          <Button type="button" variant="danger" onClick={remove} disabled={pending} aria-busy={pending}>Xoá vai trò</Button>
        )}
      </div>
    </div>
  );
}
