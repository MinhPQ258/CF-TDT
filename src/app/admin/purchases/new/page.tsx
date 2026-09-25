import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import type { AdminUser } from "@/lib/types";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PurchaseWizard } from "./purchase-wizard";

export const metadata: Metadata = { title: "Ghi phiếu mua" };

export default async function NewPurchasePage() {
  await requireAdmin();
  const users = await loadRpc<AdminUser[]>("admin_list_users");
  const members = users.filter((u) => u.current_membership);
  return (
    <>
      <PageHeader title="Ghi phiếu mua" actions={<LinkButton href="/admin/purchases">← Danh sách</LinkButton>} />
      {members.length === 0 ? (
        <EmptyState title="Quỹ chưa có thành viên" action={<LinkButton href="/admin/memberships" variant="primary">Thêm thành viên quỹ trước</LinkButton>}>
          Phiếu mua được chia đều cho thành viên quỹ tại ngày phiếu, nên cần có ít nhất một thành viên.
        </EmptyState>
      ) : (
        <PurchaseWizard payers={users.map((u) => ({ id: u.id, label: `${u.employee_code} · ${u.display_name}`, member: Boolean(u.current_membership) }))} />
      )}
    </>
  );
}
