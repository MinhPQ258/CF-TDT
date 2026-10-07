import { redirect } from "next/navigation";

/** Sổ quỹ cũ → màn Quỹ mới (tổng quan + ghi tiền vào / mua sắm + gần đây) */
export default function FundRedirect() {
  redirect("/me");
}
