import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Middleware: làm mới phiên, gắn request_id, chặn tài khoản khóa, ép đổi mật khẩu, chặn /admin nếu không phải ADMIN.

const PUBLIC_PATHS = ["/login", "/api/cron"];

function isPublic(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { "x-request-id": requestId } },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  // Chuyển hướng nhưng giữ cookie phiên vừa làm mới
  const redirectTo = (target: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const r = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    r.headers.set("x-request-id", requestId);
    return r;
  };

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (isPublic(path)) {
    if (path === "/login" && userId) return redirectTo("/");
    response.headers.set("x-request-id", requestId);
    return response;
  }

  if (!userId) {
    if (isApi) return NextResponse.json({ code: "SESSION_EXPIRED" }, { status: 401 });
    return redirectTo("/login", path === "/" ? {} : { next: path + request.nextUrl.search });
  }

  const { data: me } = await supabase.schema("api").rpc("me");
  const profile = me as { status: string; role: string; must_change_password: boolean } | null;

  if (!profile || profile.status === "DISABLED") {
    await supabase.auth.signOut();
    if (isApi) return NextResponse.json({ code: "ACCOUNT_DISABLED" }, { status: 403 });
    return redirectTo("/login", { error: profile ? "disabled" : "noprofile" });
  }

  if (profile.must_change_password && path !== "/change-password") {
    if (isApi) return NextResponse.json({ code: "MUST_CHANGE_PASSWORD" }, { status: 403 });
    return redirectTo("/change-password");
  }

  if ((path.startsWith("/admin") || path.startsWith("/api/admin")) && profile.role !== "ADMIN") {
    if (isApi) return NextResponse.json({ code: "INSUFFICIENT_PERMISSION" }, { status: 403 });
    const url = request.nextUrl.clone();
    url.pathname = "/403";
    const r = NextResponse.rewrite(url, { status: 403 });
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  }

  if (path === "/") return redirectTo(profile.role === "ADMIN" ? "/admin/dashboard" : "/me");

  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
