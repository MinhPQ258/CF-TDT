import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadRpc } from "@/lib/rpc";
import { can } from "@/lib/permissions";
import type { FundSummary } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { PurchaseForm } from "@/components/fund/purchase-form";

export const metadata: Metadata = { title: "Ghi mua sắm" };

export default async function FundBuyPage() {
  const me = await requireUser();
  if (!can(me, "purchases.manage")) redirect("/403");
  const fund = await loadRpc<FundSummary>("fund_summary");
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader back="/me" backLabel="Quay lại Quỹ" title="Ghi mua sắm" />
      <PurchaseForm cashBalance={fund.cash_balance_vnd} />
    </div>
  );
}
