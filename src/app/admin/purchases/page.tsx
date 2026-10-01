import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { formatDate } from "@/lib/dates";
import type { Paged, PurchaseSummary } from "@/lib/types";
import { Badge, EmptyState, LinkButton, Money, PageHeader, Pagination, Table, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Mua đồ" };
const PAGE_SIZE = 30;

export default async function AdminPurchasesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requirePermission("purchases.manage");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const list = await loadRpc<Paged<PurchaseSummary>>("list_purchases", { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE });
  return (
    <>
      <PageHeader title="Phiếu mua" subtitle="Chỉ ghi phiếu đã thanh toán. Tổng phiếu = tổng các dòng." actions={<LinkButton href="/admin/purchases/new" variant="primary">+ Ghi phiếu mua</LinkButton>} />
      {list.total === 0 ? (
        <EmptyState title="Chưa có phiếu mua" action={<LinkButton href="/admin/purchases/new" variant="primary">Ghi phiếu đầu tiên</LinkButton>} />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {list.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/purchases/${p.id}`}>
                  <Card className="hover:border-brand">
                    <div className="flex justify-between gap-2"><span className="min-w-0 truncate font-medium">{p.item_summary ?? p.shop ?? "Phiếu mua"}</span><Money value={p.total_vnd} tone={false} className="font-semibold" /></div>
                    <p className="text-sm text-muted">{formatDate(p.purchased_on)} · {p.paid_by === "FUND" ? "Quỹ trả" : `${p.payer} mua hộ`} · {p.share_count} người</p>
                    {p.status === "REVERSED" && <Badge tone="warn">Đã đảo</Badge>}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden md:block">
            <thead><tr><th>Ngày</th><th>Mặt hàng</th><th>Nguồn trả</th><th>Mã phiếu</th><th className="text-right">N</th><th className="text-right">Tổng</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {list.rows.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.purchased_on)}</td>
                  <td className="max-w-64 truncate"><Link className="text-brand underline" href={`/purchases/${p.id}`}>{p.item_summary ?? p.shop ?? "Phiếu mua"}</Link></td>
                  <td>{p.paid_by === "FUND" ? "Quỹ" : `Mua hộ: ${p.payer}`}</td>
                  <td>{p.external_ref ?? "—"}</td>
                  <td className="text-right">{p.share_count}</td>
                  <td className="text-right"><Money value={p.total_vnd} tone={false} /></td>
                  <td>{p.status === "REVERSED" ? <Badge tone="warn">Đã đảo</Badge> : <Badge tone="ok">Đã ghi</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} hrefFor={(n) => `/admin/purchases?page=${n}`} />
        </>
      )}
    </>
  );
}
