import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { LOCAL_SESSION_COOKIE, verifySession } from "@/lib/backend/local-session";

// Middleware: làm mới phiên, gắn request_id, chặn tài khoản khóa, ép đổi mật khẩu, chặn /admin nếu không phải ADMIN.
// Chế độ local (COFFEE_BACKEND=local): chỉ kiểm cookie ký; khóa TK / đổi MK / quyền admin do layout kiểm (lớp 2).

const PUBLIC_PATHS = ["/login", "/api/cron", "/api/health"];

function isPublic(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  let response = NextResponse.next({ request: { headers: requestHeaders } });

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
  const toLogin = () => {
    if (isApi) return NextResponse.json({ code: "SESSION_EXPIRED" }, { status: 401 });
    return redirectTo("/login", path === "/" ? {} : { next: path + request.nextUrl.search });
  };

  if (process.env.COFFEE_BACKEND === "local") {
    const userId = await verifySession(request.cookies.get(LOCAL_SESSION_COOKIE)?.value);
    // /login không tự chuyển: cookie có thể trỏ tới user đã bị xóa (DB local reset) → trang login tự kiểm
    if (isPublic(path)) return response;
    if (!userId) return toLogin();
    response.headers.set("x-request-id", requestId);
    return response;
  }

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

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (isPublic(path)) {
    if (path === "/login" && userId) return redirectTo("/");
    response.headers.set("x-request-id", requestId);
    return response;
  }

  if (!userId) return toLogin();

  const { data: me } = await supabase.schema("api").rpc("me");
  const profile = me as { status: string; role: string; must_change_password: boolean; permissions?: string[] } | null;

  if (!profile || profile.status === "DISABLED") {
    await supabase.auth.signOut();
    if (isApi) return NextResponse.json({ code: "ACCOUNT_DISABLED" }, { status: 403 });
    return redirectTo("/login", { error: profile ? "disabled" : "noprofile" });
  }

  if (profile.must_change_password && process.env.APP_FORCE_PASSWORD_CHANGE === "true" && path !== "/change-password") {
    if (isApi) return NextResponse.json({ code: "MUST_CHANGE_PASSWORD" }, { status: 403 });
    return redirectTo("/change-password");
  }

  if ((path.startsWith("/admin") || path.startsWith("/api/admin")) && profile.role !== "ADMIN" && !(profile.permissions?.length)) {
    if (isApi) return NextResponse.json({ code: "INSUFFICIENT_PERMISSION" }, { status: 403 });
    const url = request.nextUrl.clone();
    url.pathname = "/403";
    const r = NextResponse.rewrite(url, { status: 403 });
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  }

  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon.png|apple-icon.png|icon-512.png|logo.webp|manifest.webmanifest|robots.txt).*)"],
};
