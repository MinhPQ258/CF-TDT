import { requireAdmin } from "@/lib/auth";
import { AppShell, ADMIN_NAV } from "@/components/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdmin();
  return <AppShell me={me} nav={ADMIN_NAV} area="admin">{children}</AppShell>;
}
