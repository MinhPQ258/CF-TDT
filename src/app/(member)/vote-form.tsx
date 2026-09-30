"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { castVoteAction } from "@/features/votes/actions";
import type { ActionState } from "@/lib/action";
import type { MyVote, VotePrefill, VoteSession } from "@/lib/types";
import { Chip, Segment, Stepper } from "@/components/vote-controls";
import { Button, cx } from "@/components/ui";
import { FormMessage } from "@/components/form";

/**
 * Home — tích chọn đợt pha. Mobile: nút Gửi vote nằm trên thanh cố định ngay trên bottom nav (luôn trong 667px).
 * Desktop: thanh nằm cuối form.
 */
export function VoteForm({ session, initial }: { session: VoteSession; initial: MyVote | VotePrefill | null }) {
  const router = useRouter();
  const styles = session.options.styles;
  const addons = session.options.addons;
  const validStyle = (id: string | null | undefined) => (id && styles.some((s) => s.id === id) ? id : null);

  const [drink, setDrink] = useState(initial ? initial.choice === "YES" : true);
  const [style, setStyle] = useState<string | null>(validStyle(initial?.style_option_id) ?? (styles.length === 1 ? styles[0].id : null));
  const [picked, setPicked] = useState<Set<string>>(() => new Set((initial?.addon_ids ?? []).filter((id) => addons.some((a) => a.id === id))));
  const [cups, setCups] = useState(Math.min(20, Math.max(1, initial?.cups ?? 1)));
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  const summary = useMemo(() => {
    if (!drink) return "Không uống đợt này";
    const s = styles.find((x) => x.id === style)?.label ?? "Chưa chọn kiểu pha";
    const a = addons.filter((x) => picked.has(x.id)).map((x) => x.label);
    return [s, a.join(", "), session.allow_cups ? `${cups} cốc` : null].filter(Boolean).join(" · ");
  }, [drink, style, picked, cups, styles, addons, session.allow_cups]);

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  function submit() {
    if (drink && !style) {
      setState({ ok: false, message: "Chọn kiểu pha trước khi gửi", at: Date.now() });
      return;
    }
    start(async () => {
      const r = await castVoteAction({
        session_id: session.id, choice: drink ? "YES" : "NO",
        style_option_id: drink ? style : null, addon_ids: drink ? [...picked] : [],
        cups: drink && session.allow_cups ? cups : null,
      });
      if (r.ok) {
        router.replace(`/?s=${session.id}`);
        router.refresh();
      } else {
        setState({ ...r, data: undefined });
      }
    });
  }

  return (
    <div className="space-y-5 pb-28 lg:pb-0">
      <div role="radiogroup" aria-label="Bạn có uống không" className="grid grid-cols-2 gap-2">
        <Segment selected={drink} onClick={() => setDrink(true)}>Có uống</Segment>
        <Segment selected={!drink} onClick={() => setDrink(false)}>Không uống</Segment>
      </div>

      {drink && (
        <>
          <section className="space-y-2">
            <h2 className="text-[15px] font-semibold">Kiểu pha <span className="font-normal text-muted">· chọn 1</span></h2>
            <div role="radiogroup" aria-label="Kiểu pha" className="flex flex-wrap gap-2">
              {styles.map((s) => <Chip key={s.id} selected={style === s.id} onClick={() => setStyle(s.id)}>{s.label}</Chip>)}
            </div>
          </section>
          {addons.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[15px] font-semibold">Đồ đi kèm <span className="font-normal text-muted">· chọn nhiều</span></h2>
              <div className="flex flex-wrap gap-2">
                {addons.map((a) => <Chip key={a.id} multi selected={picked.has(a.id)} onClick={() => toggle(a.id)}>{a.label}</Chip>)}
              </div>
            </section>
          )}
          {session.allow_cups && (
            <section className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold">Số cốc</h2>
              <Stepper value={cups} onChange={setCups} label="Số cốc" />
            </section>
          )}
        </>
      )}

      <div className={cx(
        "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 space-y-2 border-t border-line bg-surface px-4 py-2.5",
        "lg:static lg:rounded-xl lg:border lg:p-4",
      )}>
        <FormMessage state={state} loginNext={`/?s=${session.id}`} />
        <p className="truncate text-sm text-muted" aria-live="polite">{summary}</p>
        <Button type="button" onClick={submit} disabled={pending} aria-busy={pending} className="min-h-12 w-full text-[17px] font-semibold">
          {pending ? "Đang gửi…" : state.code === "NETWORK" ? "Gửi lại" : "Gửi vote"}
        </Button>
      </div>
    </div>
  );
}
