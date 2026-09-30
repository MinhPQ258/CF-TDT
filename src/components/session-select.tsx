"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** Droplist chọn đợt vote (mobile): chọn là chuyển trang */
export function SessionSelect({ options, value, label = "Chọn đợt vote" }: {
  options: { href: string; id: string; label: string }[];
  value: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        aria-busy={pending}
        onChange={(e) => {
          const o = options.find((x) => x.id === e.target.value);
          if (o) start(() => router.push(o.href));
        }}
        className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base font-medium"
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}
