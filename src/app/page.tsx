import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

// Middleware đã chuyển hướng; đây là lớp dự phòng.
export default async function Home() {
  const me = await requireUser();
  redirect(me.role === "ADMIN" ? "/admin/dashboard" : "/me");
}
