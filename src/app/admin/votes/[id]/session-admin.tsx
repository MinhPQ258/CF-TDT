"use client";

import { useActionState, useState, useTransition } from "react";
import { addVoteOptionAction, manageVoteSessionAction, setVoteCutoffAction, setVoteOptionHiddenAction } from "@/features/votes/actions";
import type { ActionState } from "@/lib/action";
import type { VoteOptions, VoteSessionDetail } from "@/lib/types";
import { Button, Card, Input, cx } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";

/** Văn bản danh sách pha để dán vào chat nhóm */
function brewText(s: VoteSessionDetail): string {
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
  const [cutState, setCutState] = useState<ActionState>({});
  const [cutoff, setCutoff] = useState("");
  const [pending, start] = useTransition();
  const s = session;
  return (
    <Card title="Điều khiển đợt">
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
        <div className="space-y-1">
          <label htmlFor="new-cutoff" className="text-sm font-medium">Đổi giờ chốt</label>
          <div className="flex gap-2">
            <Input id="new-cutoff" type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
            <Button type="button" variant="secondary" disabled={!cutoff || pending} onClick={() => start(async () => {
              setCutState(await setVoteCutoffAction({ session_id: s.id, service_date: s.service_date, cutoff_time: cutoff }));
            })}>Lưu</Button>
          </div>
          <FormMessage state={cutState} />
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

/** Thêm lựa chọn khi đợt đang chạy; ẩn lựa chọn (chưa ai chọn → xóa hẳn). */
export function OptionManager({ sessionId, options }: { sessionId: string; options: VoteOptions }) {
  const [opts, setOpts] = useState(options);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ STYLE: string; ADDON: string }>({ STYLE: "", ADDON: "" });

  const run = (p: Promise<ActionState<VoteOptions>>) => start(async () => {
    const r = await p;
    setState({ ...r, data: undefined });
    if (r.ok && r.data) setOpts(r.data);
  });

  const group = (kind: "STYLE" | "ADDON", title: string, list: VoteOptions["styles"]) => (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {list.map((o) => (
          <li key={o.id} className={cx("inline-flex min-h-10 items-center rounded-full pl-3 text-sm", o.hidden ? "bg-bg text-muted line-through" : "bg-brand-soft")}>
            {o.label}
            <button type="button" disabled={pending} aria-label={o.hidden ? `Hiện lại ${o.label}` : `Ẩn ${o.label}`}
              onClick={() => run(setVoteOptionHiddenAction({ session_id: sessionId, option_id: o.id, hidden: !o.hidden }))}
              className="min-h-10 px-3 text-xs font-semibold text-brand">{o.hidden ? "Hiện" : "Ẩn"}</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input aria-label={`Thêm ${title.toLowerCase()}`} placeholder="Thêm…" maxLength={40} value={draft[kind]}
          onChange={(e) => setDraft({ ...draft, [kind]: e.target.value })} className="border-dashed" />
        <Button type="button" variant="secondary" disabled={pending || !draft[kind].trim()} onClick={() => {
          run(addVoteOptionAction({ session_id: sessionId, kind, label: draft[kind] }));
          setDraft({ ...draft, [kind]: "" });
        }}>+</Button>
      </div>
    </div>
  );

  return (
    <Card title="Lựa chọn của đợt">
      <div className="space-y-4">
        <FormMessage state={state} />
        {group("STYLE", "Kiểu pha", opts.styles)}
        {group("ADDON", "Đồ đi kèm", opts.addons)}
        <p className="text-xs text-muted">Ẩn: phiếu mới không chọn được nữa; phiếu cũ giữ nguyên. Lựa chọn chưa ai chọn sẽ bị xóa hẳn.</p>
      </div>
    </Card>
  );
}
