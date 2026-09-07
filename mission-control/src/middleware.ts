import { NextRequest, NextResponse } from "next/server";
import { BOOTSTRAP_HINT, decide, loadOrCreateSessionToken } from "@/lib/server-auth";

// Next 16 with a src/ app dir only detects this file at src/middleware.ts
// (build scans path.join(appDir, '..'), not the project root).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  runtime: "nodejs",
};

export function middleware(request: NextRequest) {
  const sessionToken = loadOrCreateSessionToken();
  const authorization = request.headers.get("authorization");
  const pathname = request.nextUrl.pathname;
  const decision = decide(
    {
      method: request.method,
      pathname,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      cookieToken: request.cookies.get("mc_session")?.value ?? null,
      bearerToken: authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : null,
      queryToken: request.nextUrl.searchParams.get("token"),
    },
    sessionToken,
  );

  if (decision.action === "deny") {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: decision.reason }, { status: decision.status });
    }
    // A page load without the cookie: say how to bootstrap, hand out nothing.
    return new NextResponse(`${decision.status} — ${BOOTSTRAP_HINT}\n`, {
      status: decision.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (decision.action === "allow-set-cookie") {
    // One-time bootstrap via ?token=: set the cookie, then redirect to the same
    // URL without the token so it never lingers in history, referrers or logs.
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("token");
    const response = NextResponse.redirect(clean, 303);
    response.cookies.set("mc_session", sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    return response;
  }

  return NextResponse.next();
}
