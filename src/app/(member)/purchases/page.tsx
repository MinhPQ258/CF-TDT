import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate } from "@/lib/dates";
import type { Paged, PurchaseSummary } from "@/lib/types";
import { Badge, Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";

export const metadata: Metadata = { title: "Phiếu mua" };
const PAGE_SIZE = 20;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireUser();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [list, fund] = await Promise.all([
    loadRpc<Paged<PurchaseSummary>>("list_purchases", { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    loadRpc<{ cash_balance_vnd: number }>("fund_summary"),
  ]);

  return (
    <>
      <PageHeader title="Phiếu mua" subtitle={<>Tổng quỹ thực hiện có: <Money value={fund.cash_balance_vnd} className="font-semibold" /></>} />
      {list.total === 0 ? (
        <EmptyState title="Chưa có phiếu mua nào" />
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {list.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/purchases/${p.id}`} className="block">
                  <Card className="h-full hover:border-brand">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-semibold">{p.item_summary ?? p.shop ?? "Phiếu mua"}</p>
                      <Money value={p.total_vnd} tone={false} className="font-semibold" />
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {formatDate(p.purchased_on)} · {p.paid_by === "FUND" ? "Quỹ trả" : `${p.payer} mua hộ`} · chia {p.share_count} người
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span>Phần của bạn: <Money value={p.my_share_vnd} /></span>
                      {p.my_credit_vnd > 0 && <span>· Ghi có mua hộ: <Money value={p.my_credit_vnd} sign /></span>}
                      {p.status === "REVERSED" && <Badge tone="warn">Đã đảo</Badge>}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} hrefFor={(n) => `/purchases?page=${n}`} />
        </>
      )}
    </>
  );
}
