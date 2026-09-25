"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commitImportAction, discardImportAction, type CommitResult } from "@/features/excel/actions";
import type { ActionState } from "@/lib/action";
import { IMPORT_KIND_LABEL, IMPORT_STATUS_LABEL } from "@/lib/labels";
import { IMPORT_SPECS } from "@/lib/excel/spec";
import { formatVnd } from "@/lib/money";
import type { ImportJob } from "@/lib/types";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { FormMessage } from "@/components/form";
import { TempPassword } from "../users/temp-password";

export function JobPreview({ job }: { job: ImportJob }) {
  const [state, setState] = useState<ActionState<CommitResult>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const spec = IMPORT_SPECS[job.kind];
  const rows = job.rows ?? [];
  const errorRows = rows.filter((r) => r.errors.length > 0);
  const canCommit = job.status === "READY" && !state.ok;

  return (
    <Card title={`Preview: ${IMPORT_KIND_LABEL[job.kind]} — ${job.file_name}`}
      actions={<Badge tone={job.status === "READY" ? "ok" : job.status === "COMMITTED" ? "brand" : "danger"}>{IMPORT_STATUS_LABEL[job.status]}</Badge>}>
      <div className="space-y-3">
        <FormMessage state={state} loginNext={`/admin/import-export?job=${job.id}`} />
        {state.data?.accounts && state.data.accounts.length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold">Tài khoản mới — mật khẩu tạm chỉ hiện một lần:</p>
            {state.data.accounts.map((a) => <TempPassword key={a.username} username={a.username} password={a.temp_password} />)}
          </div>
        )}
        <p className="text-sm">
          {job.summary.rows ?? job.row_count} dòng · {job.summary.documents ?? 0} chứng từ hợp lệ
          {job.summary.total_vnd ? ` · tổng ${formatVnd(job.summary.total_vnd)}` : ""}
          {job.summary.new_accounts ? ` · ${job.summary.new_accounts} tài khoản sẽ được tạo` : ""}
        </p>
        {errorRows.length > 0 && (
          <Alert tone="danger" title={`${errorRows.length} dòng lỗi — không ghi dòng nào cho tới khi sửa hết`}>
            <ul className="mt-1 space-y-1 text-sm">
              {errorRows.slice(0, 50).map((r) => <li key={r.row_no}><strong>Dòng {r.row_no}:</strong> {r.errors.join("; ")}</li>)}
              {errorRows.length > 50 && <li>… và {errorRows.length - 50} dòng khác</li>}
            </ul>
          </Alert>
        )}
        {job.status === "STALE" && <Alert tone="warn" title="Dữ liệu đã thay đổi sau lần xem trước">Preview dưới đây đã được tính lại. Kiểm tra rồi bấm ghi.</Alert>}

        <div className="max-h-[60dvh] overflow-auto rounded-lg border border-line">
          <table className="min-w-full text-left text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:sticky [&_th]:top-0 [&_th]:bg-bg [&_th]:px-2 [&_th]:py-1">
            <thead><tr><th>Dòng</th>{spec.columns.map((c) => <th key={c.key} className="whitespace-nowrap">{c.label}</th>)}<th>Chia</th><th>Lỗi</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row_no} className={r.errors.length ? "bg-danger-soft" : "border-t border-line"}>
                  <td>{r.row_no}</td>
                  {spec.columns.map((c) => {
                    const v = r.data[c.key];
                    return <td key={c.key} className="whitespace-nowrap">{v == null ? "" : c.type === "money" && typeof v === "number" ? formatVnd(v, { unit: false }) : String(v)}</td>;
                  })}
                  <td className="whitespace-nowrap">{r.normalized?.split ? `${r.normalized.split.n} người × ${formatVnd(r.normalized.split.base_share_vnd, { unit: false })}${r.normalized.split.remainder ? ` (+1đ ×${r.normalized.split.remainder})` : ""}` : ""}</td>
                  <td className="min-w-48 text-danger">{r.errors.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {job.status !== "COMMITTED" && job.status !== "DISCARDED" && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => start(async () => {
              const r = await discardImportAction({ job_id: job.id });
              setState({ ...r, data: undefined });
              if (r.ok) router.push("/admin/import-export");
            })}>Hủy lần import</Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => { setState({}); router.refresh(); }}>Tính lại preview</Button>
            <Button type="button" className="flex-1" disabled={!canCommit || pending || !job.preview_hash} onClick={() => start(async () => {
              const r = await commitImportAction({ job_id: job.id, preview_hash: job.preview_hash! });
              setState(r);
              router.refresh();
            })}>{pending ? "Đang ghi…" : "Xác nhận ghi toàn bộ"}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
