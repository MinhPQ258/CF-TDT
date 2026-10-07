import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { can } from "@/lib/permissions";
import type { AdminUser } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { DepositForm } from "@/components/fund/deposit-form";

export const metadata: Metadata = { title: "Ghi tiền vào" };

export default async function FundInPage() {
  const me = await requireUser();
  if (!can(me, "fund.manage")) redirect("/403");
  const users = await loadRpc<AdminUser[]>("admin_list_users");
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader back="/me" backLabel="Quay lại Quỹ" title="Ghi tiền vào" />
      <DepositForm people={users.map((u) => ({ id: u.id, name: u.display_name, disabled: u.status === "DISABLED" }))} />
    </div>
  );
}
