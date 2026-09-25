import type { AllocationMember } from "@/lib/types";
import { Money } from "@/components/ui";

/** Bảng phân bổ preview: ai chịu bao nhiêu, ai nhận +1đ, số dư trước → sau */
export function AllocationTable({ members, showCredit }: { members: AllocationMember[]; showCredit?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {members.map((m) => (
        <li key={m.user_id} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{m.display_name}</p>
            <p className="text-xs text-muted">
              {m.employee_code}
              {m.gets_extra_one && " · +1đ làm tròn"}
              {showCredit && m.credit_vnd > 0 && <> · ghi có mua hộ <Money value={m.credit_vnd} sign /></>}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <Money value={m.share_vnd} sign className="font-semibold" />
            <p className="text-xs text-muted"><Money value={m.balance_before_vnd} tone={false} /> → <Money value={m.balance_after_vnd} /></p>
          </div>
        </li>
      ))}
    </ul>
  );
}
