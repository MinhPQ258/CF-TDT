"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { manageVoteSessionAction } from "@/features/votes/actions";
import type { ActionState } from "@/lib/action";
import type { VoteSessionDetail } from "@/lib/types";
import { Button, Card, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";

/** Văn bản danh sách pha để dán vào chat nhóm */
export function brewText(s: VoteSessionDetail): string {
  const lines = [`${s.name} — ${s.yes_count} người, ${s.cups_total} cốc`];
  for (const st of s.by_style) {
    const people = s.votes.filter((v) => v.choice === "YES" && v.style_label === st.label)
      .map((v) => `${v.display_name}${v.addon_labels.length ? ` (${v.addon_labels.join(", ")})` : ""}${v.cups && v.cups > 1 ? ` ×${v.cups}` : ""}`);
    lines.push(`• ${st.label} ${st.cups} cốc: ${people.join("; ")}`);
  }
  return lines.join("\n");
}

export function CopyBrewList({ s }: { s: VoteSessionDetail }) {
  const [done, setDone] = useState<"ok" | "fail" | null>(null);
  return (
    <Button type="button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(brewText(s));
        setDone("ok");
      } catch {
        setDone("fail");
      }
    }}>{done === "ok" ? "Đã sao chép" : done === "fail" ? "Không sao chép được" : "Sao chép danh sách pha"}</Button>
  );
}

export function SessionActions({ session }: { session: VoteSessionDetail }) {
  const [state, action] = useActionState<ActionState, FormData>(manageVoteSessionAction, {});
  const s = session;
  return (
    <Card title="Trạng thái đợt">
      <div className="space-y-3">
        <FormMessage state={state} />
        <div className="flex flex-wrap gap-2">
          {s.state === "DRAFT" && (
            <form action={action}><input type="hidden" name="session_id" value={s.id} /><input type="hidden" name="op" value="publish" /><SubmitButton>Đăng đợt</SubmitButton></form>
          )}
          {(s.state === "OPEN" || s.state === "UPCOMING") && (
            <form action={action}><input type="hidden" name="session_id" value={s.id} /><input type="hidden" name="op" value="close" /><SubmitButton variant="secondary">Chốt sớm</SubmitButton></form>
          )}
        </div>
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-danger">Hủy đợt…</summary>
          <form action={action} className="mt-2 space-y-2">
            <input type="hidden" name="session_id" value={s.id} /><input type="hidden" name="op" value="cancel" />
            <Input name="reason" placeholder="Lý do hủy" required aria-label="Lý do hủy" />
            <SubmitButton variant="danger" className="w-full">Xác nhận hủy</SubmitButton>
          </form>
        </details>
      </div>
    </Card>
  );
}

/** Nút ⋯ cạnh tên đợt (mobile): Chỉnh sửa, Sao chép danh sách pha */
export function SessionMoreMenu({ s }: { s: VoteSessionDetail }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const item = "flex min-h-11 w-full items-center px-4 text-left hover:bg-bg focus:bg-bg focus:outline-none";
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label="Thao tác đợt" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex size-11 items-center justify-center rounded-full hover:bg-brand-soft">
        <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
          <Link ref={firstItem} role="menuitem" href={`/admin/votes/${s.id}/edit`} className={item}>Chỉnh sửa</Link>
          <button type="button" role="menuitem" className={item} onClick={async () => {
            try {
              await navigator.clipboard.writeText(brewText(s));
              setCopied("ok");
            } catch {
              setCopied("fail");
            }
            setTimeout(() => { setOpen(false); setCopied(null); }, 900);
          }}>{copied === "ok" ? "Đã sao chép ✓" : copied === "fail" ? "Không sao chép được" : "Sao chép danh sách pha"}</button>
        </div>
      )}
    </div>
  );
}
