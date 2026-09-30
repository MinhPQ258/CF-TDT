"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVoteSessionAction } from "@/features/votes/actions";
import type { ActionState } from "@/lib/action";
import type { VoteSession, VoteTemplate } from "@/lib/types";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { FormMessage } from "@/components/form";

function vnHHmm(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
}

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

export function CreateSessionForm({ today, templates }: { today: string; templates: VoteTemplate[] }) {
  const router = useRouter();
  const first = templates[0];
  const [tpl, setTpl] = useState(first?.id ?? "");
  const [name, setName] = useState(first?.name ?? "Pha sáng");
  const [date, setDate] = useState(today);
  const [opens, setOpens] = useState(first ? vnHHmm(first.opens_at) : "07:30");
  const [cutoff, setCutoff] = useState(first ? vnHHmm(first.cutoff_at) : "09:00");
  // Giờ pha mặc định = giờ chốt; đi theo giờ chốt cho tới khi admin tự sửa ô giờ pha
  const [brew, setBrew] = useState(first ? vnHHmm(first.cutoff_at) : "09:00");
  const [brewTouched, setBrewTouched] = useState(false);
  const [styles, setStyles] = useState<string[]>(first ? first.options.styles.map((x) => x.label) : ["Phin", "Máy"]);
  const [addons, setAddons] = useState<string[]>(first ? first.options.addons.map((x) => x.label) : ["Sữa đặc", "Đường", "Đá"]);
  const [allowCups, setAllowCups] = useState(first?.allow_cups ?? true);
  const [state, setState] = useState<ActionState<VoteSession>>({});
  const [pending, start] = useTransition();

  function applyTemplate(id: string) {
    setTpl(id);
    const t = templates.find((x) => x.id === id);
    if (!t) {
      setStyles([]);
      setAddons([]);
      return;
    }
    setName(t.name);
    setOpens(vnHHmm(t.opens_at));
    setCutoff(vnHHmm(t.cutoff_at));
    setBrew(vnHHmm(t.cutoff_at));
    setBrewTouched(false);
    setStyles(t.options.styles.map((x) => x.label));
    setAddons(t.options.addons.map((x) => x.label));
    setAllowCups(t.allow_cups);
  }

  function submit(publish: boolean) {
    start(async () => {
      const r = await createVoteSessionAction({
        name, service_date: date, opens_time: opens, cutoff_time: cutoff, brew_time: brew,
        styles, addons, allow_cups: allowCups, publish, copy_from: null,
      });
      setState(r);
      if (r.ok && r.data) {
        router.push(`/admin/votes?s=${r.data.id}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Tạo đợt pha</h2>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
              Dùng lại lựa chọn từ
              <Select value={tpl} onChange={(e) => applyTemplate(e.target.value)} className="w-56">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.service_date.split("-").reverse().slice(0, 2).join("/")}</option>)}
                <option value="">Trống</option>
              </Select>
            </label>
          </div>
          <FormMessage state={state} loginNext="/admin/votes" />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Tên đợt" htmlFor="v-name" required error={state.fieldErrors?.name}>
              <Input id="v-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Ngày" htmlFor="v-date" required error={state.fieldErrors?.service_date}>
              <Input id="v-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:max-w-md">
            <Field label="Mở" htmlFor="v-open" hint="Trống = mở ngay">
              <Input id="v-open" type="time" value={opens} onChange={(e) => setOpens(e.target.value)} />
            </Field>
            <Field label="Chốt" htmlFor="v-cut" required error={state.fieldErrors?.cutoff_time}>
              <Input id="v-cut" type="time" value={cutoff} onChange={(e) => { setCutoff(e.target.value); if (!brewTouched) setBrew(e.target.value); }} />
            </Field>
            <Field label="Pha" htmlFor="v-brew">
              <Input id="v-brew" type="time" value={brew} onChange={(e) => { setBrew(e.target.value); setBrewTouched(true); }} />
            </Field>
          </div>
        </Card>
        <div className="grid gap-3 lg:grid-cols-2">
          <LabelList label="Kiểu pha" hint="Người dùng chọn 1" items={styles} onChange={setStyles} placeholder="VD: Bạc xỉu" max={10} />
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
          <Button type="button" variant="secondary" disabled={pending} onClick={() => submit(false)}>Lưu nháp</Button>
          <Button type="button" disabled={pending || styles.length === 0} onClick={() => submit(true)}>{pending ? "Đang tạo…" : "Đăng đợt pha"}</Button>
        </div>
      </div>

      <aside aria-label="Người dùng sẽ thấy" className="hidden xl:block">
        <p className="mb-2 text-sm font-semibold text-muted">Người dùng sẽ thấy trên điện thoại</p>
        <div className="sticky top-4 space-y-2.5 rounded-[22px] border-2 border-ink bg-bg px-3 py-3.5">
          <div className="flex items-baseline justify-between"><strong>{name || "Tên đợt"}</strong><span className="text-xs font-semibold text-ok">Đang mở</span></div>
          <p className="text-xs text-muted">Chốt {cutoff || "--:--"}{brew ? ` · pha ${brew}` : ""}</p>
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
