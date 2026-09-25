import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { callRpc, loadRpc } from "@/lib/rpc";
import { firstOfMonth, formatDateTime, vnToday } from "@/lib/dates";
import { IMPORT_KIND_LABEL, IMPORT_STATUS_LABEL } from "@/lib/labels";
import { IMPORT_SPECS } from "@/lib/excel/spec";
import type { ImportJob, ImportKind } from "@/lib/types";
import { Badge, Card, Input, PageHeader, buttonClass } from "@/components/ui";
import { UploadForm } from "./upload-form";
import { JobPreview } from "./job-preview";

export const metadata: Metadata = { title: "Nhập / xuất Excel" };

export default async function ImportExportPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  await requireAdmin();
  const { job: jobId } = await searchParams;
  const today = vnToday();
  const [jobs, job] = await Promise.all([
    loadRpc<ImportJob[]>("import_list_jobs", { p_limit: 15 }),
    jobId && /^[0-9a-f-]{36}$/i.test(jobId) ? callRpc<ImportJob>("import_preview", { p_job_id: jobId }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Nhập / xuất Excel" subtitle="Import nguyên khối: một dòng lỗi thì không ghi dòng nào. Một file chỉ import được một lần." />

      {job?.ok && <div className="mb-4"><JobPreview job={job.data} /></div>}
      {job && !job.ok && <p className="mb-4 text-danger">{job.error.message}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Nhập dữ liệu">
          <UploadForm />
          <details className="mt-4">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-brand">Tải file mẫu</summary>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {(Object.keys(IMPORT_SPECS) as ImportKind[]).map((k) => (
                <li key={k}><a className={buttonClass("secondary", "w-full")} href={`/api/admin/import-template?kind=${k}`}>Mẫu {IMPORT_KIND_LABEL[k]}</a></li>
              ))}
            </ul>
          </details>
        </Card>
        <Card title="Xuất báo cáo">
          <form action="/api/admin/export" method="get" className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col">Từ ngày<Input type="date" name="from" defaultValue={firstOfMonth(today)} required /></label>
              <label className="flex flex-col">Đến ngày<Input type="date" name="to" defaultValue={today} required /></label>
            </div>
            <p className="text-sm text-muted">6 sheet: Tong_quan, So_du_theo_nguoi, Tien_nop, Tien_cho_them, Mua_do_va_phan_bo, Vote. Tối đa 12 tháng.</p>
            <button className={buttonClass("primary", "w-full")}>Tải file .xlsx</button>
          </form>
        </Card>
      </div>

      <Card title="Các lần import gần đây" className="mt-4">
        {jobs.length === 0 ? <p className="text-muted">Chưa có.</p> : (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link className="font-medium text-brand underline" href={`/admin/import-export?job=${j.id}`}>{IMPORT_KIND_LABEL[j.kind]}</Link>
                  <span className="block truncate text-sm text-muted">{j.file_name} · {j.row_count} dòng · {formatDateTime(j.created_at, true)} · {j.created_by_name}</span>
                </span>
                <Badge tone={j.status === "COMMITTED" ? "ok" : j.status === "HAS_ERRORS" ? "danger" : j.status === "DISCARDED" ? "neutral" : "warn"}>{IMPORT_STATUS_LABEL[j.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
