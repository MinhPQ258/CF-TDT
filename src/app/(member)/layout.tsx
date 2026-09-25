import { requireUser } from "@/lib/auth";
import { AppShell, MEMBER_NAV } from "@/components/app-shell";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return <AppShell me={me} nav={MEMBER_NAV} area="member">{children}</AppShell>;
}
