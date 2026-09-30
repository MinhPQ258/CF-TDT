import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { CreateSessionForm } from "@/components/create-session-form";

export const metadata: Metadata = { title: "Tạo đợt vote" };

/** Nút ＋ trên thanh tab: ai cũng tạo được đợt vote (thành viên: đăng ngay). */
export default async function NewVotePage() {
  const me = await requireUser();
  const admin = me.role === "ADMIN";
  return (
    <>
      <PageHeader back={admin ? "/admin/votes" : "/"} title="Tạo đợt vote"
        subtitle="Đợt được đăng ngay cho mọi người vote." />
      <CreateSessionForm doneBase={admin ? "/admin/votes" : "/"} />
    </>
  );
}
