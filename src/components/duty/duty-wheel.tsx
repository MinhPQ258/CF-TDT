"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDutyMemberAction, deleteDutyMemberAction, renameDutyMemberAction, resetDutyMembersAction, setDutyActiveAction, spinDutyAction,
} from "@/features/duty/actions";
import type { ActionState } from "@/lib/action";
import type { DutyMember, DutySpinResult } from "@/lib/types";
import { Button, Input } from "@/components/ui";
import { FormMessage } from "@/components/form";
import { dutyColor, dutyInk } from "@/components/duty/colors";

const initialOf = (n: string) => n.trim().split(/\s+/).pop()?.[0]?.toUpperCase() ?? "?";
const SPIN_MS = 4200;
const SIZE = 300;

/**
 * Vòng quay trực nhật (chỉ người có quyền duty.manage). Server chọn người trúng; vòng quay xoay tới đúng ô đó.
 * Danh sách có ô tích: tích = có trên vòng quay. "Xoá người khỏi vòng quay sau khi có kết quả": server bỏ tích người trúng;
 * vòng quay cập nhật khi đóng kết quả.
 */
export function DutyWheel({ initialMembers }: { initialMembers: DutyMember[] }) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  // trong lúc quay / xem kết quả: vẽ đúng các ô server dùng để chọn
  const [wheelOverride, setWheelOverride] = useState<DutyMember[] | null>(null);
  const [rot, setRot] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<DutySpinResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [removeAfter, setRemoveAfter] = useState(true);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Danh sách mới từ server (vd. sau Reset lịch sử): nhận khi không đang quay / xem kết quả
  useEffect(() => {
    if (!spinning && !wheelOverride) setMembers(initialMembers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ đồng bộ khi server gửi danh sách mới
  }, [initialMembers]);

  const wheel = wheelOverride ?? members.filter((m) => m.active !== false);
  const colorOf = new Map(wheel.map((m, i) => [m.id, dutyColor(i)]));
  const n = wheel.length;
  const seg = n ? 360 / n : 360;
  const stops = n ? wheel.map((_, i) => `${dutyColor(i)} ${i * seg}deg ${(i + 1) * seg}deg`).join(", ") : "#e7e1db 0deg 360deg";
  const font = n > 12 ? 11 : n > 8 ? 12 : 14;

  function spin() {
    if (spinning || pending || n < 2) return;
    setState({});
    start(async () => {
      const r = await spinDutyAction(removeAfter);
      if (!r.ok || !r.data) { setState(r); return; }
      const res = r.data;
      setWheelOverride(res.members_before); // đúng các ô, đúng thứ tự server dùng để chọn
      const s = 360 / res.members_before.length;
      const mid = res.index * s + s / 2 + (Math.random() - 0.5) * s * 0.6;
      setRot((cur) => cur + 360 * 6 + (((360 - mid) - (cur % 360)) % 360 + 360) % 360);
      setSpinning(true);
      setResult(res);
      timer.current = setTimeout(() => {
        setSpinning(false);
        setShowResult(true);
        router.refresh(); // lịch sử quay
      }, SPIN_MS);
    });
  }

  function closeResult(again: boolean) {
    if (result) setMembers(result.members);
    setWheelOverride(null);
    setShowResult(false);
    setResult(null);
    if (again) setTimeout(spin, 50);
  }

  const run = (p: Promise<ActionState<DutyMember[]>>, after?: () => void) => start(async () => {
    const r = await p;
    setState({ ...r, data: undefined, message: r.ok ? undefined : r.message });
    if (r.ok && r.data) { setMembers(r.data); after?.(); }
  });

  return (
    <div className="space-y-4">
      <section aria-label="Vòng quay" className="flex flex-col items-center gap-2.5">
        <div className="relative flex items-end justify-center" style={{ width: SIZE, height: SIZE + 18 }}>
          <svg width="34" height="30" viewBox="0 0 34 30" aria-hidden className="absolute top-0 z-10 drop-shadow" style={{ left: SIZE / 2 - 17 }}>
            <path d="M17 30 2 4a3 3 0 0 1 2.6-4.5h24.8A3 3 0 0 1 32 4z" fill="#1f1a17" />
          </svg>
          <button type="button" onClick={spin} disabled={spinning || pending || n < 2}
            aria-label={n < 2 ? "Cần ít nhất 2 người để quay" : "Quay vòng quay"}
            className="relative rounded-full disabled:cursor-not-allowed" style={{ width: SIZE, height: SIZE }}>
            <span className="absolute inset-0 block overflow-hidden rounded-full shadow-[0_0_0_6px_#fff,0_6px_22px_rgba(31,26,23,0.18)]"
              style={{ background: `conic-gradient(${stops})`, transform: `rotate(${rot}deg)`, transition: `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.7, 0.1, 1)` }}>
              {wheel.map((m, i) => (
                <span key={m.id} className="absolute flex items-center justify-end overflow-hidden whitespace-nowrap font-semibold"
                  style={{
                    left: SIZE / 2, top: SIZE / 2 - 10, width: SIZE / 2, height: 20, transformOrigin: "0 50%",
                    transform: `rotate(${i * seg + seg / 2 - 90}deg)`, padding: "0 16px 0 40px", boxSizing: "border-box",
                    fontSize: font, color: dutyInk(dutyColor(i)),
                  }}>
                  {m.name}
                </span>
              ))}
            </span>
            <span aria-hidden className="absolute flex items-center justify-center rounded-full border-4 border-bg bg-surface text-[13px] font-bold text-brand shadow-md"
              style={{ left: SIZE / 2 - 32, top: SIZE / 2 - 32, width: 64, height: 64 }}>
              {spinning || pending ? "…" : "QUAY"}
            </span>
          </button>
        </div>
        <p className="min-h-5 text-sm text-muted" aria-live="polite">
          {n < 2 ? "Cần ít nhất 2 người trong danh sách" : spinning ? "Đang quay…" : "Chạm vòng quay để quay"}
        </p>
      </section>

      <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface px-3.5">
        <input type="checkbox" checked={removeAfter} onChange={(e) => setRemoveAfter(e.target.checked)} className="size-5 accent-[#6f4428]" />
        <span>
          <span className="block font-semibold">Xoá người khỏi vòng quay sau khi có kết quả</span>
          <span className="block text-xs text-muted">Bỏ tích người đã trúng; tên vẫn giữ trong danh sách</span>
        </span>
      </label>

      <FormMessage state={state} />

      <section aria-labelledby="duty-list" className="space-y-2.5 rounded-2xl border border-line bg-surface px-3.5 pb-1.5 pt-3">
        <div className="flex items-center justify-between">
          <h2 id="duty-list" className="font-semibold" title="Số người đang trên vòng quay / tổng số trong danh sách">Danh sách ({members.filter((m) => m.active !== false).length}/{members.length})</h2>
          <button type="button" disabled={pending || spinning}
            onClick={() => { if (window.confirm("Nạp lại danh sách = mọi tài khoản đang hoạt động?")) run(resetDutyMembersAction()); }}
            className="min-h-11 whitespace-nowrap px-0.5 text-sm font-semibold text-brand">Nạp lại tất cả</button>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) run(addDutyMemberAction(draft), () => setDraft("")); }}>
          <Input aria-label="Thêm người" placeholder="Thêm tên…" maxLength={60} value={draft} onChange={(e) => setDraft(e.target.value)} className="border-dashed" />
          <Button type="submit" variant="secondary" disabled={pending || !draft.trim()} aria-busy={pending}>+ Thêm</Button>
        </form>
        <ul>
          {members.map((m) => (
            <li key={m.id} className="flex min-h-[52px] items-center gap-2.5 border-t border-line/70">
              <input type="checkbox" checked={m.active !== false} disabled={pending || spinning}
                aria-label={`Hiện ${m.name} trên vòng quay`}
                onChange={(e) => run(setDutyActiveAction(m.id, e.target.checked))}
                className="size-5 shrink-0 accent-[#6f4428]" />
              <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: colorOf.get(m.id) ?? "#d6ccc3" }} />
              {editing === m.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); run(renameDutyMemberAction(m.id, editText), () => setEditing(null)); }}>
                  <Input aria-label="Sửa tên" autoFocus maxLength={60} value={editText} onChange={(e) => setEditText(e.target.value)} className="min-h-10 border-2 border-brand" />
                  <Button type="submit" className="min-h-10" disabled={pending || !editText.trim()} aria-busy={pending}>Lưu</Button>
                </form>
              ) : (
                <>
                  <span className={m.active === false ? "min-w-0 flex-1 truncate text-muted" : "min-w-0 flex-1 truncate"}>{m.name}</span>
                  <button type="button" aria-label={`Sửa ${m.name}`} disabled={pending || spinning} onClick={() => { setEditing(m.id); setEditText(m.name); }}
                    className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-bg">
                    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /></svg>
                  </button>
                  <button type="button" aria-label={`Xoá ${m.name}`} disabled={pending || spinning} onClick={() => run(deleteDutyMemberAction(m.id))}
                    className="flex size-10 items-center justify-center rounded-lg text-danger hover:bg-bg">
                    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {showResult && result && (
        <div role="dialog" aria-modal="true" aria-labelledby="duty-result" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3.5 rounded-[22px] bg-surface px-5 pb-5 pt-6 text-center">
            <span aria-hidden className="flex size-16 items-center justify-center rounded-full text-[26px] font-bold"
              style={{ background: dutyColor(result.index), color: dutyInk(dutyColor(result.index)) }}>
              {initialOf(result.winner.name)}
            </span>
            <p id="duty-result" className="text-sm text-muted">Người trực nhật hôm nay</p>
            <p className="text-[28px] font-bold leading-tight">{result.winner.name}</p>
            {removeAfter && <p className="text-sm text-muted">Đã bỏ khỏi vòng quay (tên vẫn trong danh sách).</p>}
            <div className="mt-1 grid w-full grid-cols-2 gap-2.5">
              <Button type="button" variant="secondary" className="min-h-12" onClick={() => closeResult(true)}>Quay lại</Button>
              <Button type="button" className="min-h-12 font-bold" onClick={() => closeResult(false)} autoFocus>Xong</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

