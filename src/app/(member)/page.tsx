import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { VoteHome } from "@/components/vote-home";

export const metadata: Metadata = { title: "Pha cà phê" };

/** Home thành viên (mobile trước): đợt pha đang mở → tích chọn → Gửi → kết quả. */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ s?: string; edit?: string }> }) {
  const me = await requireUser();
  const { s, edit } = await searchParams;
  return <VoteHome me={me} base="/" selected={s} edit={edit} othersHref="/votes" />;
}
