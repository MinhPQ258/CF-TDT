"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { castVoteAction } from "@/features/votes/actions";
import type { ActionState } from "@/lib/action";
import type { MyVote, VotePerson, VotePrefill, VoteSession } from "@/lib/types";
import { Chip, Segment, Stepper } from "@/components/vote-controls";
import { Button, Select, cx } from "@/components/ui";
import { FormMessage } from "@/components/form";

/**
 * Home — tích chọn đợt pha. Mobile: nút Gửi vote nằm trên thanh cố định ngay trên bottom nav (luôn trong 667px).
 * Desktop: thanh nằm cuối form.
 */
type Opt = VoteSession["options"]["styles"][number];

/** Kiểu pha · Đồ đi kèm · Số cốc — dùng chung cho phiếu của mình và từng người được đặt hộ */
function DrinkChoices({ styles, addons, allowCups, style, onStyle, picked, onToggle, cups, onCups, who }: {
  styles: Opt[]; addons: Opt[]; allowCups: boolean;
  style: string | null; onStyle: (id: string) => void;
  picked: Set<string>; onToggle: (id: string) => void;
  cups: number; onCups: (n: number) => void;
  /** tên người được đặt hộ (để đặt nhãn truy cập) */
  who?: string;
}) {
  const of = who ? ` của ${who}` : "";
  return (
    <>
      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold">Kiểu pha <span className="font-normal text-muted">· chọn 1</span></h2>
        <div role="radiogroup" aria-label={`Kiểu pha${of}`} className="flex flex-wrap gap-2">
          {styles.map((s) => <Chip key={s.id} selected={style === s.id} onClick={() => onStyle(s.id)}>{s.label}</Chip>)}
        </div>
      </section>
      {addons.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">Đồ đi kèm <span className="font-normal text-muted">· chọn nhiều</span></h2>
          <div className="flex flex-wrap gap-2" aria-label={`Đồ đi kèm${of}`}>
            {addons.map((a) => <Chip key={a.id} multi selected={picked.has(a.id)} onClick={() => onToggle(a.id)}>{a.label}</Chip>)}
          </div>
        </section>
      )}
      {allowCups && (
        <section className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Số cốc</h2>
          <Stepper value={cups} onChange={onCups} label={`Số cốc${of}`} />
        </section>
      )}
    </>
  );
}

interface Proxy { user_id: string; name: string; style: string | null; addons: Set<string>; cups: number }

export function VoteForm({ session, initial, doneHref, loginNext, people = [] }: {
  session: VoteSession; initial: MyVote | VotePrefill | null;
  /** người có thể đặt hộ (trừ mình) */
  people?: VotePerson[];
  /** chuyển tới sau khi gửi thành công (trang kết quả của đợt) */
  doneHref: string; loginNext: string;
}) {
  const router = useRouter();
  const styles = session.options.styles;
  const addons = session.options.addons;
  const validStyle = (id: string | null | undefined) => (id && styles.some((s) => s.id === id) ? id : null);

  const [drink, setDrink] = useState(initial ? initial.choice === "YES" : true);
  const [style, setStyle] = useState<string | null>(validStyle(initial?.style_option_id) ?? (styles.length === 1 ? styles[0].id : null));
  const [picked, setPicked] = useState<Set<string>>(() => new Set((initial?.addon_ids ?? []).filter((id) => addons.some((a) => a.id === id))));
  const [cups, setCups] = useState(Math.min(20, Math.max(1, initial?.cups ?? 1)));
  const initialProxies = session.my_proxies ?? [];
  const [proxies, setProxies] = useState<Proxy[]>(() => initialProxies.map((p) => ({
    user_id: p.user_id, name: p.display_name, style: validStyle(p.style_option_id),
    addons: new Set(p.addon_ids.filter((id) => addons.some((a) => a.id === id))), cups: Math.min(20, Math.max(1, p.cups ?? 1)),
  })));
  const [adding, setAdding] = useState("");
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  const summary = useMemo(() => {
    if (!drink) return "Không uống đợt này";
    const s = styles.find((x) => x.id === style)?.label ?? "Chưa chọn kiểu pha";
    const a = addons.filter((x) => picked.has(x.id)).map((x) => x.label);
    const mine = [s, a.join(", "), session.allow_cups ? `${cups} cốc` : null].filter(Boolean).join(" · ");
    return proxies.length ? `${mine} · đặt hộ ${proxies.length} người` : mine;
  }, [drink, style, picked, cups, styles, addons, session.allow_cups, proxies.length]);
  const summaryNo = proxies.length ? `Không uống · đặt hộ ${proxies.length} người` : null;

  const chosen = new Set(proxies.map((p) => p.user_id));
  const addable = people.filter((p) => p.status !== "SELF" && !chosen.has(p.id));
  const patch = (uid: string, f: (p: Proxy) => Proxy) => setProxies((xs) => xs.map((p) => (p.user_id === uid ? f(p) : p)));
  function addProxy(uid: string) {
    const p = people.find((x) => x.id === uid);
    if (!p) return;
    // điền sẵn theo lựa chọn của mình cho nhanh; sửa riêng từng người được
    setProxies((xs) => [...xs, { user_id: p.id, name: p.display_name, style: drink ? style : null, addons: new Set(drink ? picked : []), cups: 1 }]);
    setAdding("");
  }

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
    const missing = proxies.find((p) => !p.style);
    if (missing) {
      setState({ ok: false, message: `Chọn kiểu pha cho ${missing.name}`, at: Date.now() });
      return;
    }
    start(async () => {
      const r = await castVoteAction({
        session_id: session.id, choice: drink ? "YES" : "NO",
        style_option_id: drink ? style : null, addon_ids: drink ? [...picked] : [],
        cups: drink && session.allow_cups ? cups : null,
        proxies: proxies.map((p) => ({ user_id: p.user_id, style_option_id: p.style!, addon_ids: [...p.addons], cups: session.allow_cups ? p.cups : null })),
        remove_proxies: initialProxies.map((p) => p.user_id).filter((id) => !chosen.has(id)),
      });
      if (r.ok) {
        router.replace(doneHref);
        router.refresh();
      } else {
        setState({ ...r, data: undefined });
      }
    });
  }

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Bạn có uống không" className="grid grid-cols-2 gap-2">
        <Segment selected={drink} onClick={() => setDrink(true)}>Có uống</Segment>
        <Segment selected={!drink} onClick={() => setDrink(false)}>Không uống</Segment>
      </div>

      {drink && (
        <>
          <DrinkChoices styles={styles} addons={addons} allowCups={session.allow_cups}
            style={style} onStyle={setStyle} picked={picked} onToggle={toggle} cups={cups} onCups={setCups} />
        </>
      )}

      {(people.length > 0 || proxies.length > 0) && (
        <section className="space-y-3 border-t border-line pt-4" aria-label="Đặt hộ người khác">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Đặt hộ người khác</h2>
            {proxies.length > 0 && <span className="text-sm text-muted">{proxies.length} người</span>}
          </div>
          {proxies.map((p) => (
            <div key={p.user_id} className="space-y-4 rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate font-semibold">Đặt hộ: {p.name}</p>
                <button type="button" aria-label={`Bỏ đặt hộ ${p.name}`} onClick={() => setProxies((xs) => xs.filter((x) => x.user_id !== p.user_id))}
                  className="min-h-10 shrink-0 px-2 text-sm text-danger">Bỏ</button>
              </div>
              <DrinkChoices styles={styles} addons={addons} allowCups={session.allow_cups} who={p.name}
                style={p.style} onStyle={(id) => patch(p.user_id, (x) => ({ ...x, style: id }))}
                picked={p.addons} onToggle={(id) => patch(p.user_id, (x) => {
                  const next = new Set(x.addons);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return { ...x, addons: next };
                })}
                cups={p.cups} onCups={(n) => patch(p.user_id, (x) => ({ ...x, cups: n }))} />
            </div>
          ))}
          {addable.length > 0 && (
            <Select aria-label="Chọn người được đặt hộ" value={adding} onChange={(e) => addProxy(e.target.value)}>
              <option value="">+ Chọn người được đặt hộ…</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}{p.status === "OTHER" ? " (đã có người đặt hộ)" : p.status === "MINE" ? " (bạn đã đặt hộ)" : ""}</option>
              ))}
            </Select>
          )}
        </section>
      )}

      <div className={cx(
        "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 space-y-2 border-t border-line bg-surface px-4 py-2.5",
        "lg:static lg:rounded-xl lg:border lg:p-4",
      )}>
        <FormMessage state={state} loginNext={loginNext} />
        <p className="truncate text-sm text-muted" aria-live="polite">{!drink && summaryNo ? summaryNo : summary}</p>
        <Button type="button" onClick={submit} disabled={pending} aria-busy={pending} className="min-h-12 w-full text-[17px] font-semibold">
          {pending ? "Đang gửi…" : state.code === "NETWORK" ? "Gửi lại" : proxies.length > 0 ? `Gửi vote (${proxies.length + 1} người)` : "Gửi vote"}
        </Button>
      </div>
    </div>
  );
}
