import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import type { DutyState } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { DutyWheel } from "@/components/duty/duty-wheel";
import { dutyColor, dutyInk } from "@/components/duty/colors";

export const metadata: Metadata = { title: "Trực nhật" };

const fmt = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
  const day = d.toLocaleDateString("en-GB", { timeZone: "Asia/Ho_Chi_Minh" });
  return `${t} ${day}`;
};
const initialOf = (n: string) => n.trim().split(/\s+/).pop()?.[0]?.toUpperCase() ?? "?";

/**
 * Trực nhật: người có quyền "Trực nhật" (duty.manage) thấy vòng quay + sửa danh sách;
 * mọi người khác chỉ xem lịch sử quay.
 */
export default async function DutyPage() {
  await requireUser();
  const s = await loadRpc<DutyState>("duty_state", { p_limit: 50 });
  const latest = s.history[0];

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Trực nhật" subtitle={s.can_manage ? "Chạm vào vòng quay để chọn người" : "Lịch sử chọn người trực nhật"} />

      {s.can_manage ? (
        <DutyWheel initialMembers={s.members ?? []} />
      ) : latest ? (
        <section aria-label="Người trực nhật gần nhất" className="flex items-center gap-4 rounded-[20px] bg-brand p-5 text-brand-ink">
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl font-bold">{initialOf(latest.name)}</span>
          <span className="min-w-0">
            <span className="block text-sm opacity-85">Người trực nhật gần nhất</span>
            <span className="block truncate text-2xl font-bold">{latest.name}</span>
            <span className="block text-sm opacity-85">Quay lúc {fmt(latest.spun_at)}</span>
          </span>
        </section>
      ) : null}

      <section aria-labelledby="duty-history" className="rounded-2xl border border-line bg-surface px-3.5 pb-1.5 pt-1">
        <h2 id="duty-history" className="flex min-h-11 items-center font-semibold">Lịch sử quay ({s.total_spins})</h2>
        {s.history.length === 0 ? (
          <p className="pb-3 text-sm text-muted">Chưa có lần quay nào.</p>
        ) : (
          <ol>
            {s.history.map((h, i) => {
              const c = dutyColor(h.id);
              return (
                <li key={h.id} className="flex min-h-14 items-center gap-3 border-t border-line/70">
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-bold" style={{ background: c, color: dutyInk(c) }}>
                    {initialOf(h.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{h.name}</span>
                    <span className="block text-xs text-muted">Quay lúc {fmt(h.spun_at)}</span>
                  </span>
                  {i === 0 && <span className="shrink-0 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok">Mới nhất</span>}
                </li>
              );
            })}
          </ol>
        )}
        {s.total_spins > s.history.length && <p className="pb-2 text-center text-xs text-muted">Hiện {s.history.length} lần gần nhất.</p>}
      </section>
    </div>
  );
}
