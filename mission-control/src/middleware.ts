import { NextRequest, NextResponse } from "next/server";

/**
 * API authentication middleware.
 *
 * Protects all /api/* routes with a Bearer token check.
 * Token is read from MC_AUTH_TOKEN env var. If unset, auth is disabled
 * (localhost-only deployments). When set, every API request must include:
 *   Authorization: Bearer <token>
 *
 * Page routes (non-API) are not gated — the dashboard is a local UI.
 */

const AUTH_TOKEN = process.env.MC_AUTH_TOKEN || "";

export function middleware(request: NextRequest) {
  // Only gate API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Body size limit (1MB) for mutation requests
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  const MAX_BODY_SIZE = 1024 * 1024; // 1MB
  if (contentLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: `Request body too large (${contentLength} bytes, max ${MAX_BODY_SIZE})` },
      { status: 413 }
    );
  }

  // SSE endpoints use EventSource which can't set headers — allow if
  // the token is passed as a query param instead.
  const tokenFromQuery = request.nextUrl.searchParams.get("token");

  // If no token is configured, auth is disabled (backwards-compatible)
  if (!AUTH_TOKEN) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const providedToken = bearer || tokenFromQuery || "";

  if (!providedToken) {
    return NextResponse.json(
      { error: "Missing Authorization header" },
      { status: 401 }
    );
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(providedToken, AUTH_TOKEN)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 403 });
  }

  return NextResponse.next();
}

/** Constant-time string comparison (Edge Runtime compatible). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a full comparison to avoid length-based timing leak
    let result = a.length ^ b.length;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return result === 0;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const config = {
  matcher: "/api/:path*",
};
