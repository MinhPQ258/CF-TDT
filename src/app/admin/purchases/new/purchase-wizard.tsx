"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { postPurchaseAction, previewPurchaseAction } from "@/features/fund/actions";
import type { ActionState } from "@/lib/action";
import type { EventResult, LineType, PaidBy, PurchasePreview } from "@/lib/types";
import { vnToday } from "@/lib/dates";
import { formatVnd, parseVnd } from "@/lib/money";
import { LINE_TYPE_LABEL } from "@/lib/labels";
import { Button, Card, Field, Input, Select, cx } from "@/components/ui";
import { FormMessage } from "@/components/form";
import { AllocationTable } from "@/components/allocation-table";
import { SplitExplanation } from "@/components/purchase-bits";

interface LineDraft {
  key: string;
  line_type: LineType;
  item_name: string;
  quantity: string;
  unit: string;
  amount: string;
}

interface Draft {
  occurred_on: string;
  paid_by: PaidBy;
  payer_user_id: string;
  shop: string;
  external_ref: string;
  notes: string;
  lines: LineDraft[];
  idem_key: string;
}

const DRAFT_KEY = "coffee-tdt:purchase-draft";
const newLine = (t: LineType = "ITEM"): LineDraft => ({ key: crypto.randomUUID(), line_type: t, item_name: t === "FEE" ? "Phí ship" : t === "DISCOUNT" ? "Giảm giá" : "", quantity: "", unit: "", amount: "" });
const emptyDraft = (): Draft => ({ occurred_on: vnToday(), paid_by: "FUND", payer_user_id: "", shop: "", external_ref: "", notes: "", lines: [newLine()], idem_key: crypto.randomUUID() });

/** Số tiền dòng theo loại: giảm giá luôn âm */
function lineAmount(l: LineDraft): number | null {
  const n = parseVnd(l.amount);
  if (n === null) return null;
  return l.line_type === "DISCOUNT" ? -Math.abs(n) : Math.abs(n);
}

/**
 * Mobile: 3 bước (thông tin → dòng hàng → xem trước & xác nhận). Desktop: form và preview cùng màn.
 * Nháp lưu sessionStorage để không mất dữ liệu khi phiên hết hạn. Idempotency key sinh khi mở form.
 */
export function PurchaseWizard({ payers }: { payers: { id: string; label: string; member: boolean }[] }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState<PurchasePreview | null>(null);
  const [state, setState] = useState<ActionState<EventResult>>({});
  const [pending, start] = useTransition();
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        setDraft(JSON.parse(raw) as Draft);
        setRestored(true);
      }
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Không lưu được nháp (chế độ riêng tư) — form vẫn hoạt động
      return;
    }
  }, [draft]);

  const update = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setPreview(null); };
  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    update({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  // Tổng hiển thị tạm khi gõ; tổng chính thức do DB tính trong preview
  const runningTotal = useMemo(() => draft.lines.reduce((s, l) => s + (lineAmount(l) ?? 0), 0), [draft.lines]);

  const payload = () => ({
    occurred_on: draft.occurred_on,
    paid_by: draft.paid_by,
    payer_user_id: draft.paid_by === "MEMBER" ? draft.payer_user_id || null : null,
    lines: draft.lines.map((l) => ({
      line_type: l.line_type, item_name: l.item_name.trim(),
      quantity: l.quantity ? Number(l.quantity.replace(",", ".")) : null, unit: l.unit.trim() || null,
      line_amount_vnd: lineAmount(l) ?? NaN,
    })),
  });

  function localCheck(): string | null {
    if (draft.paid_by === "MEMBER" && !draft.payer_user_id) return "Chọn người mua hộ";
    for (const [i, l] of draft.lines.entries()) {
      if (!l.item_name.trim()) return `Dòng ${i + 1}: nhập tên`;
      if (lineAmount(l) === null) return `Dòng ${i + 1}: nhập số tiền`;
      if (l.quantity && !(Number(l.quantity.replace(",", ".")) > 0)) return `Dòng ${i + 1}: số lượng phải > 0`;
    }
    if (runningTotal <= 0) return "Tổng phiếu phải lớn hơn 0";
    return null;
  }

  function doPreview() {
    const err = localCheck();
    if (err) return setState({ ok: false, message: err, at: Date.now() });
    start(async () => {
      const r = await previewPurchaseAction(payload());
      setState(r.ok ? {} : { ...r, data: undefined });
      if (r.ok && r.data) { setPreview(r.data); setStep(3); }
    });
  }

  function doPost() {
    if (!preview) return;
    start(async () => {
      const r = await postPurchaseAction({ ...payload(), idem_key: draft.idem_key, preview_hash: preview.preview_hash,
        shop: draft.shop || null, external_ref: draft.external_ref || null, notes: draft.notes || null });
      setState(r);
      if (r.ok) {
        sessionStorage.removeItem(DRAFT_KEY);
        setDraft(emptyDraft());
        setPreview(null);
        setStep(1);
        setRestored(false);
      } else if (r.code === "MEMBERSHIP_CHANGED") {
        setPreview(null);
        setStep(2);
      }
    });
  }

  const stepClass = (n: number) => cx(step === n ? "block" : "hidden", "lg:block");

  return (
    <div className="space-y-4">
      {restored && <p className="rounded-lg bg-brand-soft p-2 text-sm">Đã khôi phục nháp phiếu chưa ghi. <button className="underline" onClick={() => { setDraft(emptyDraft()); setRestored(false); setPreview(null); }}>Bỏ nháp</button></p>}
      <FormMessage state={state} loginNext="/admin/purchases/new" />
      {state.ok && state.data && (
        <p><Link className="text-brand underline" href={state.data.purchase_id ? `/purchases/${state.data.purchase_id}` : `/admin/fund/${state.data.event_id}`}>Xem phiếu vừa ghi</Link></p>
      )}

      <ol className="grid grid-cols-3 gap-1 text-center text-sm lg:hidden" aria-label="Các bước">
        {["Thông tin", "Dòng hàng", "Xác nhận"].map((t, i) => (
          <li key={t} className={cx("rounded-md py-2", step === i + 1 ? "bg-brand text-brand-ink font-semibold" : "bg-surface text-muted")}>{i + 1}. {t}</li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <Card title="1. Thông tin phiếu" className={stepClass(1)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ngày mua" htmlFor="occurred_on" required>
                <Input id="occurred_on" type="date" max={vnToday()} value={draft.occurred_on} onChange={(e) => update({ occurred_on: e.target.value })} />
              </Field>
              <Field label="Nguồn trả" htmlFor="paid_by" required>
                <Select id="paid_by" value={draft.paid_by} onChange={(e) => update({ paid_by: e.target.value as PaidBy })}>
                  <option value="FUND">Quỹ trả</option>
                  <option value="MEMBER">Cá nhân mua hộ</option>
                </Select>
              </Field>
              {draft.paid_by === "MEMBER" && (
                <Field label="Người mua hộ" htmlFor="payer" required hint="Được ghi có toàn bộ tổng phiếu và vẫn chịu phần chia của mình">
                  <Select id="payer" value={draft.payer_user_id} onChange={(e) => update({ payer_user_id: e.target.value })}>
                    <option value="">— Chọn —</option>
                    {payers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.member ? "" : " (đã khóa)"}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Cửa hàng" htmlFor="shop"><Input id="shop" maxLength={200} value={draft.shop} onChange={(e) => update({ shop: e.target.value })} /></Field>
              <Field label="Mã phiếu/hóa đơn" htmlFor="external_ref" hint="Tùy chọn, không được trùng"><Input id="external_ref" maxLength={64} value={draft.external_ref} onChange={(e) => update({ external_ref: e.target.value })} /></Field>
              <Field label="Ghi chú" htmlFor="notes"><Input id="notes" maxLength={500} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} /></Field>
            </div>
            <Button className="mt-4 w-full lg:hidden" type="button" onClick={() => setStep(2)}>Tiếp: dòng hàng →</Button>
          </Card>

          <Card title="2. Dòng hàng" className={stepClass(2)}>
            <ul className="space-y-3">
              {draft.lines.map((l, i) => (
                <li key={l.key} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">Dòng {i + 1}</span>
                    {draft.lines.length > 1 && <button type="button" className="min-h-11 px-2 text-sm text-danger" onClick={() => update({ lines: draft.lines.filter((x) => x.key !== l.key) })}>Xóa dòng</button>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <Select aria-label="Loại dòng" value={l.line_type} onChange={(e) => updateLine(l.key, { line_type: e.target.value as LineType })}>
                      {(["ITEM", "FEE", "DISCOUNT"] as const).map((t) => <option key={t} value={t}>{LINE_TYPE_LABEL[t]}</option>)}
                    </Select>
                    <Input aria-label="Tên mặt hàng" placeholder="Tên mặt hàng" maxLength={200} value={l.item_name} onChange={(e) => updateLine(l.key, { item_name: e.target.value })} />
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_1fr_1.5fr] gap-2">
                    <Input aria-label="Số lượng" placeholder="SL" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                    <Input aria-label="Đơn vị" placeholder="Đơn vị" maxLength={32} value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} />
                    <Input aria-label="Thành tiền" placeholder="Thành tiền ₫" inputMode="numeric" value={l.amount} onChange={(e) => updateLine(l.key, { amount: e.target.value })} className="text-right" />
                  </div>
                  {lineAmount(l) !== null && <p className="mt-1 text-right text-sm text-muted">{formatVnd(lineAmount(l))}</p>}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => update({ lines: [...draft.lines, newLine("ITEM")] })}>+ Mặt hàng</Button>
              <Button type="button" variant="secondary" onClick={() => update({ lines: [...draft.lines, newLine("FEE")] })}>+ Phí</Button>
              <Button type="button" variant="secondary" onClick={() => update({ lines: [...draft.lines, newLine("DISCOUNT")] })}>+ Giảm giá</Button>
            </div>
            <p className="mt-3 flex justify-between border-t border-line pt-3 text-lg font-semibold">
              <span>Tổng (tạm tính)</span><span className={cx("num", runningTotal <= 0 && "text-danger")}>{formatVnd(runningTotal)}</span>
            </p>
            <div className="mt-4 flex gap-2 lg:hidden">
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>←</Button>
              <Button type="button" className="flex-1" aria-busy={pending} disabled={pending} onClick={doPreview}>{pending ? "Đang tính…" : "Xem trước phân bổ →"}</Button>
            </div>
          </Card>
        </div>

        <div className={cx(stepClass(3), "lg:sticky lg:top-4 lg:self-start")}>
          <Card title="3. Xem trước & xác nhận">
            {!preview ? (
              <div className="space-y-3">
                <p className="text-muted">Bấm xem trước để hệ thống tính danh sách người chia tại ngày phiếu và phần của từng người.</p>
                <Button type="button" className="hidden w-full lg:inline-flex" aria-busy={pending} disabled={pending} onClick={doPreview}>{pending ? "Đang tính…" : "Xem trước phân bổ"}</Button>
                <Button type="button" variant="secondary" className="w-full lg:hidden" onClick={() => setStep(2)}>← Quay lại dòng hàng</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="flex justify-between text-lg font-semibold"><span>Tổng phiếu</span><span className="num">{formatVnd(preview.total_vnd)}</span></p>
                <p className="text-sm">{preview.paid_by === "FUND" ? <>Quỹ thực giảm <strong>{formatVnd(preview.total_vnd)}</strong>.</> : "Quỹ thực không đổi (cá nhân mua hộ)."}</p>
                <SplitExplanation total={preview.total_vnd} split={preview.split} />
                <div className="max-h-[50dvh] overflow-y-auto"><AllocationTable members={preview.members} showCredit /></div>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" aria-busy={pending} disabled={pending} onClick={() => { setPreview(null); setStep(2); }}>Sửa</Button>
                  <Button type="button" className="flex-1" aria-busy={pending} disabled={pending} onClick={doPost}>{pending ? "Đang ghi…" : "Xác nhận ghi phiếu"}</Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
