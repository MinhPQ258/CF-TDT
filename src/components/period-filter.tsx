import { Input, buttonClass } from "@/components/ui";

/** Bộ lọc kỳ [from, to] (GET form, không cần JS) */
export function PeriodFilter({ from, to, action, extra }: { from: string; to: string; action: string; extra?: React.ReactNode }) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-sm">
        Từ ngày
        <Input type="date" name="from" defaultValue={from} className="w-40" />
      </label>
      <label className="flex flex-col text-sm">
        Đến ngày
        <Input type="date" name="to" defaultValue={to} className="w-40" />
      </label>
      {extra}
      <button className={buttonClass("secondary")}>Xem</button>
    </form>
  );
}
