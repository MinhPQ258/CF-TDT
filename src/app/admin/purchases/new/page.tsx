import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import type { AdminUser } from "@/lib/types";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PurchaseWizard } from "./purchase-wizard";

export const metadata: Metadata = { title: "Ghi phiếu mua" };

export default async function NewPurchasePage() {
  await requirePermission("purchases.manage");
  const users = await loadRpc<AdminUser[]>("admin_list_users");
  const members = users.filter((u) => u.status === "ACTIVE");
  return (
    <>
      <PageHeader back="/admin/purchases" backLabel="Quay lại danh sách phiếu" title="Ghi phiếu mua" />
      {members.length === 0 ? (
        <EmptyState title="Chưa có tài khoản hoạt động" action={<LinkButton href="/admin/users" variant="primary">Tạo tài khoản</LinkButton>}>
          Phiếu mua được chia đều cho mọi tài khoản đang hoạt động.
        </EmptyState>
      ) : (
        <PurchaseWizard payers={users.map((u) => ({ id: u.id, label: `${u.employee_code} · ${u.display_name}`, member: u.status === "ACTIVE" }))} />
      )}
    </>
  );
}
