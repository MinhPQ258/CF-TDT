"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVoteSessionAction, updateVoteSessionAction } from "@/features/votes/actions";
import type { ActionState } from "@/lib/action";
import type { VoteSession } from "@/lib/types";
import { Button, Card, Field, Input } from "@/components/ui";
import { FormMessage } from "@/components/form";

/** Danh sách nhãn: thêm (Enter hoặc nút), xóa bằng ×, không trùng */
function LabelList({ label, hint, items, onChange, placeholder, max, chip }: {
  label: string; hint: string; items: string[]; onChange: (xs: string[]) => void; placeholder: string; max: number; chip?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = label.replace(/\s+/g, "-").toLowerCase();
  function add() {
    const v = draft.trim();
    if (!v) return;
    if (v.length > 40) return setError("Tối đa 40 ký tự");
    if (items.some((x) => x.toLowerCase() === v.toLowerCase())) return setError(`"${v}" đã có`);
    if (items.length >= max) return setError(`Tối đa ${max} lựa chọn`);
    onChange([...items, v]);
    setDraft("");
    setError(null);
  }
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{label}</h2>
        <span className="text-sm text-muted">{hint}</span>
      </div>
      {items.length === 0 && <p className="text-sm text-muted">Chưa có lựa chọn.</p>}
      <ul className={chip ? "flex flex-wrap gap-2" : "flex flex-col gap-2"}>
        {items.map((x, i) => (
          <li key={x} className={chip
            ? "inline-flex min-h-10 items-center rounded-full bg-brand-soft pl-3"
            : "flex min-h-11 items-center rounded-lg border border-line pl-3"}>
            <span className={chip ? "" : "flex-grow"}>{x}</span>
            <button type="button" aria-label={`Xóa ${x}`} onClick={() => onChange(items.filter((_, k) => k !== i))}
              className="size-10 text-lg text-danger">×</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input id={`${id}-new`} aria-label={`Thêm ${label.toLowerCase()}`} placeholder={placeholder} value={draft} maxLength={40}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="border-dashed" />
        <Button type="button" variant="secondary" onClick={add}>+ Thêm</Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}

/** Thời điểm (ISO hoặc Date) → "YYYY-MM-DDTHH:mm" theo giờ VN */
export function vnLocalInput(t: string | Date): string {
  const d = typeof t === "string" ? new Date(t) : t;
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
  return `${date}T${time}`;
}

/** "YYYY-MM-DDTHH:mm" → "HH:mm dd/mm/yyyy" */
const showDateTime = (v: string) => (v ? `${v.slice(11, 16)} ${v.slice(0, 10).split("-").reverse().join("/")}` : "hh:mm dd/mm/yyyy");

const DEFAULT_NAME = "Pha cà phê";

/** Ô giờ + ngày hiển thị "hh:mm dd/mm/yyyy"; bấm vào mở bộ chọn ngày giờ của trình duyệt */
function DateTimeField({ id, value, min, onChange }: { id: string; value: string; min?: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <div aria-hidden className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 text-base tabular-nums">
        <span className="whitespace-nowrap">{showDateTime(value)}</span>
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </div>
      <input ref={ref} id={id} type="datetime-local" min={min} value={value} required
        onChange={(e) => e.target.value && onChange(e.target.value.slice(0, 16))}
        onClick={() => { try { ref.current?.showPicker(); } catch { /* trình duyệt không hỗ trợ */ } }}
        className="absolute inset-0 size-full cursor-pointer opacity-0" />
    </div>
  );
}

/** Dữ liệu đợt có sẵn khi chỉnh sửa */
export interface SessionFormValues {
  /** opens / cutoff: "YYYY-MM-DDTHH:mm" giờ VN */
  id: string; name: string; opens: string; cutoff: string;
  styles: string[]; addons: string[]; allow_cups: boolean;
}

/** Tạo đợt; truyền `editing` thì thành màn Chỉnh sửa (cùng giao diện) */
export function CreateSessionForm({ doneBase, editing, doneHref }: {
  /** tạo xong chuyển tới `${doneBase}?s=<id>` */
  doneBase: string;
  editing?: SessionFormValues;
  /** lưu chỉnh sửa xong chuyển tới */
  doneHref?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(editing?.name ?? DEFAULT_NAME);
  const [opens, setOpens] = useState(() => editing?.opens ?? vnLocalInput(new Date()));
  const [cutoff, setCutoff] = useState(() => editing?.cutoff ?? vnLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [styles, setStyles] = useState<string[]>(editing?.styles ?? ["Espresso", "Latte"]);
  const [addons, setAddons] = useState<string[]>(editing?.addons ?? ["Sữa đặc", "Đường", "Đá"]);
  const [allowCups, setAllowCups] = useState(editing?.allow_cups ?? true);
  const [state, setState] = useState<ActionState<VoteSession>>({});
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      // Giờ pha = giờ chốt
      // Ngày của đợt = ngày chốt
      const base = {
        name: name.trim() || DEFAULT_NAME, service_date: cutoff.slice(0, 10), cutoff_time: cutoff.slice(11, 16), brew_time: cutoff.slice(11, 16),
        opens_date: opens.slice(0, 10), opens_time: opens.slice(11, 16), styles, addons, allow_cups: allowCups,
      };
      const r = editing
        ? await updateVoteSessionAction({ ...base, session_id: editing.id })
        : await createVoteSessionAction({ ...base, publish: true, copy_from: null });
      setState(r);
      if (r.ok && editing) {
        router.push(doneHref ?? doneBase);
        router.refresh();
      } else if (r.ok && r.data) {
        router.push(`${doneBase}${doneBase.includes("?") ? "&" : "?"}s=${r.data.id}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{editing ? "Chỉnh sửa đợt pha" : "Tạo đợt pha"}</h2>
          <FormMessage state={state} loginNext={doneBase} />
          <Field label="Tên đợt" htmlFor="v-name" error={state.fieldErrors?.name}>
            <Input id="v-name" value={name} maxLength={100} placeholder={DEFAULT_NAME} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="mt-3 grid gap-3 sm:max-w-xs">
            <Field label="Giờ mở" htmlFor="v-open" error={state.fieldErrors?.opens_time}>
              <DateTimeField id="v-open" value={opens} onChange={setOpens} />
            </Field>
            <Field label="Giờ chốt" htmlFor="v-cut" required error={state.fieldErrors?.cutoff_time ?? state.fieldErrors?.service_date}>
              <DateTimeField id="v-cut" value={cutoff} min={opens} onChange={setCutoff} />
            </Field>
          </div>
        </Card>
        <div className="grid gap-3 lg:grid-cols-2">
          <LabelList label="Kiểu pha" hint="Người dùng chọn 1" items={styles} onChange={setStyles} placeholder="VD: Bạc xỉu" max={10} chip />
          <div className="flex flex-col gap-3">
            <LabelList label="Đồ đi kèm" hint="Người dùng chọn nhiều" items={addons} onChange={setAddons} placeholder="VD: Kem cheese" max={20} chip />
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface px-4">
              <input type="checkbox" checked={allowCups} onChange={(e) => setAllowCups(e.target.checked)} className="size-5 accent-[#6f4428]" />
              Cho nhập số cốc (1–20)
            </label>
          </div>
        </div>
        {state.fieldErrors?.styles && <p className="text-sm text-danger">{state.fieldErrors.styles}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" className="min-w-32" aria-busy={pending} disabled={pending || styles.length === 0} onClick={submit}>{pending ? (editing ? "Đang lưu…" : "Đang tạo…") : editing ? "Lưu" : "Tạo"}</Button>
        </div>
      </div>

      <aside aria-label="Người dùng sẽ thấy" className="hidden xl:block">
        <p className="mb-2 text-sm font-semibold text-muted">Người dùng sẽ thấy trên điện thoại</p>
        <div className="sticky top-4 space-y-2.5 rounded-[22px] border-2 border-ink bg-bg px-3 py-3.5">
          <div className="flex items-baseline justify-between"><strong>{name.trim() || DEFAULT_NAME}</strong><span className="text-xs font-semibold text-ok">Đang mở</span></div>
          <p className="text-xs text-muted">Chốt {cutoff ? showDateTime(cutoff) : "--:--"}</p>
          <p className="text-xs font-semibold">Kiểu pha</p>
          <div className="flex flex-wrap gap-1.5">{styles.map((x) => <span key={x} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[13px]">{x}</span>)}</div>
          {addons.length > 0 && <>
            <p className="text-xs font-semibold">Đồ đi kèm</p>
            <div className="flex flex-wrap gap-1.5">{addons.map((x) => <span key={x} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[13px]">{x}</span>)}</div>
          </>}
          {allowCups && <p className="text-xs">Số cốc: − 1 +</p>}
          <p className="flex min-h-9 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-brand-ink">Gửi vote</p>
        </div>
      </aside>
    </div>
  );
}
