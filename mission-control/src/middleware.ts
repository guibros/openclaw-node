import { NextRequest, NextResponse } from "next/server";
import { decide, loadOrCreateSessionToken } from "@/lib/server-auth";

// Next 16 with a src/ app dir only detects this file at src/middleware.ts
// (build scans path.join(appDir, '..'), not the project root).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  runtime: "nodejs",
};

export function middleware(request: NextRequest) {
  const sessionToken = loadOrCreateSessionToken();
  const authorization = request.headers.get("authorization");
  const decision = decide(
    {
      method: request.method,
      pathname: request.nextUrl.pathname,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      cookieToken: request.cookies.get("mc_session")?.value ?? null,
      bearerToken: authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : null,
    },
    sessionToken,
  );

  if (decision.action === "deny") {
    return NextResponse.json({ error: decision.reason }, { status: decision.status });
  }
  const response = NextResponse.next();
  if (decision.action === "allow-set-cookie") {
    response.cookies.set("mc_session", sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
  }
  return response;
}
