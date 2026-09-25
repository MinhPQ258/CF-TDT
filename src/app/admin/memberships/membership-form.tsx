"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { membershipImpactAction, saveMembershipAction, type MembershipImpact } from "@/features/memberships/actions";
import type { ActionState } from "@/lib/action";
import type { Membership } from "@/lib/types";
import { vnToday } from "@/lib/dates";
import { formatVnd } from "@/lib/money";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ConfirmDialog, FormMessage } from "@/components/form";

/**
 * Tạo/sửa membership. Trước khi lưu: tính số phiếu đã post bị "lệch lịch sử" và số dư,
 * hiện hộp xác nhận (quyết định 3′, 4A). Phiếu cũ KHÔNG bị tính lại.
 */
export function MembershipForm({ membership, users }: { membership?: Membership; users: { id: string; label: string }[] }) {
  const [userId, setUserId] = useState(membership?.user_id ?? "");
  const [start, setStart] = useState(membership?.start_date ?? vnToday());
  const [end, setEnd] = useState(membership?.end_date ?? "");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<MembershipImpact | null>(null);
  const [state, setState] = useState<ActionState>({});
  const [pending, start_] = useTransition();
  const idp = membership?.id ?? "new";
  const closing = Boolean(end) && (!membership?.end_date || membership.end_date !== end);

  const input = { membership_id: membership?.id, user_id: membership ? undefined : userId, start_date: start, end_date: end || undefined };

  function review() {
    if (!reason.trim()) {
      setState({ ok: false, message: "Nhập lý do thay đổi", fieldErrors: { reason: "Lý do bắt buộc" }, at: Date.now() });
      return;
    }
    start_(async () => {
      const r = await membershipImpactAction(input);
      if (!r.ok || !r.data) return setState(r);
      setState({});
      setImpact(r.data);
    });
  }

  function save() {
    start_(async () => {
      const r = await saveMembershipAction({ ...input, reason });
      setImpact(null);
      setState(r);
      if (r.ok && !membership) {
        setReason("");
        setUserId("");
      }
    });
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); review(); }} noValidate>
      <FormMessage state={state} loginNext="/admin/memberships" />
      {!membership && (
        <Field label="Thành viên" htmlFor={`user-${idp}`} error={state.fieldErrors?.user_id} required>
          <Select id={`user-${idp}`} value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">— Chọn tài khoản —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Ngày bắt đầu" htmlFor={`start-${idp}`} error={state.fieldErrors?.start_date} required>
          <Input id={`start-${idp}`} type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label="Ngày kết thúc" htmlFor={`end-${idp}`} error={state.fieldErrors?.end_date} hint="Để trống = đang tham gia">
          <Input id={`end-${idp}`} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="Lý do" htmlFor={`reason-${idp}`} error={state.fieldErrors?.reason} required>
        <Textarea id={`reason-${idp}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="VD: vào quỹ từ đầu tháng / chuyển phòng" />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Đang kiểm tra…" : membership ? "Lưu thay đổi" : "Thêm vào quỹ"}</Button>

      <ConfirmDialog open={impact !== null} title="Xác nhận thay đổi membership" confirmText="Xác nhận lưu" busy={pending}
        onCancel={() => setImpact(null)} onConfirm={save}>
        {impact && (
          <>
            {impact.affected_posted_events > 0 ? (
              <p className="rounded-lg bg-warn-soft p-2">
                Khoảng mới khác với phân bổ của <strong>{impact.affected_posted_events} phiếu đã post</strong>.
                Các phiếu cũ <strong>KHÔNG bị tính lại</strong> — muốn sửa phải đảo phiếu và ghi lại.
              </p>
            ) : (
              <p>Không ảnh hưởng phiếu nào đã post.</p>
            )}
            {closing && membership && (
              <p className={impact.balance_vnd !== 0 ? "rounded-lg bg-danger-soft p-2" : ""}>
                Số dư hiện tại: <strong>{formatVnd(impact.balance_vnd, { sign: true })}</strong>.{" "}
                {impact.balance_vnd < 0 && <>Nên <Link className="underline" href="/admin/fund?form=DEPOSIT">ghi tiền nộp</Link> để tất toán.</>}
                {impact.balance_vnd > 0 && <>Nên <Link className="underline" href="/admin/fund?form=REIMBURSEMENT">ghi hoàn tiền</Link> để tất toán.</>}
                {impact.balance_vnd !== 0 && " Vẫn có thể đóng; dashboard sẽ gắn cờ \"rời quỹ chưa tất toán\"."}
              </p>
            )}
            <p className="text-sm text-muted">Lý do: {reason}</p>
          </>
        )}
      </ConfirmDialog>
    </form>
  );
}
