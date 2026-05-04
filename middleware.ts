import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Aggressive commercial crawlers that generate high egress — block them before any Supabase calls
const BOT_UA_FRAGMENTS = [
  "ahrefsbot", "semrushbot", "mj12bot", "dotbot", "bytespider",
  "petalbot", "baiduspider", "yandexbot", "serpstatbot", "dataforseobot",
  "proximic", "sogou", "ia_archiver", "sitechecker", "rogerbot",
  "seokicks", "domaincrawler", "opensiteexplorer", "linkpadbot",
  "blexbot", "sistrix", "majestic", "netsystemsresearch", "scrapy",
];

const PROTECTED_PREFIXES = ["/dashboard", "/reports", "/routes"];

export async function middleware(request: NextRequest) {
  // 1. Block aggressive bots immediately — zero Supabase calls, zero egress
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  if (BOT_UA_FRAGMENTS.some((frag) => ua.includes(frag))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 2. Only run Supabase session validation for routes that require auth.
  //    Public routes skip Supabase entirely, eliminating the per-request API call.
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isProtected) {
    return NextResponse.next();
  }

  // 3. Refresh session token and verify auth for protected routes
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not add logic between createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
