import { describe, it, expect } from "vitest";
import { decide, timingSafeEqualStr } from "../server-auth";

const TOKEN = "a".repeat(64);

function input(overrides: Partial<Parameters<typeof decide>[0]> = {}) {
  return {
    method: "GET",
    pathname: "/",
    host: "127.0.0.1:3000",
    origin: null,
    cookieToken: null,
    bearerToken: null,
    ...overrides,
  };
}

describe("decide", () => {
  it("denies 403 host for any non-loopback Host", () => {
    for (const host of ["evil.com", "evil.com:3000", "192.168.1.10:3000", null]) {
      expect(decide(input({ host, cookieToken: TOKEN }), TOKEN)).toEqual({
        action: "deny",
        status: 403,
        reason: "host",
      });
    }
  });

  it("accepts loopback Host variants (with the token)", () => {
    for (const host of ["127.0.0.1", "127.0.0.1:3000", "localhost", "localhost:3000"]) {
      expect(decide(input({ host, pathname: "/api/status", cookieToken: TOKEN }), TOKEN)).toEqual({
        action: "allow",
      });
    }
  });

  it("denies 401 for bare GET/HEAD/OPTIONS on /api — every method needs the token", () => {
    // Before: any process that could open the loopback port could read every
    // API (memory-file served openclaw.json's gateway token to a bare GET).
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(decide(input({ method, pathname: "/api/status" }), TOKEN)).toEqual({
        action: "deny",
        status: 401,
        reason: "token",
      });
    }
  });

  it("allows GET on /api with the cookie or a Bearer", () => {
    expect(decide(input({ pathname: "/api/status", cookieToken: TOKEN }), TOKEN)).toEqual({ action: "allow" });
    expect(decide(input({ pathname: "/api/status", bearerToken: TOKEN }), TOKEN)).toEqual({ action: "allow" });
  });

  it("never accepts the query token for /api (it is a page-bootstrap credential only)", () => {
    expect(decide(input({ pathname: "/api/status", queryToken: TOKEN }), TOKEN)).toEqual({
      action: "deny",
      status: 401,
      reason: "token",
    });
  });

  it("denies 403 origin for another localhost port (the viewer on :7892 is a different app)", () => {
    expect(
      decide(
        input({ method: "POST", pathname: "/api/tasks", origin: "http://localhost:7892", cookieToken: TOKEN }),
        TOKEN,
      ),
    ).toEqual({ action: "deny", status: 403, reason: "origin" });
    expect(
      decide(input({ pathname: "/api/status", origin: "http://127.0.0.1:8787", cookieToken: TOKEN }), TOKEN),
    ).toEqual({ action: "deny", status: 403, reason: "origin" });
  });

  it("denies 401 token for a bare POST to /api", () => {
    expect(decide(input({ method: "POST", pathname: "/api/tasks" }), TOKEN)).toEqual({
      action: "deny",
      status: 401,
      reason: "token",
    });
  });

  it("denies 403 origin for cross-origin POST even with a valid cookie", () => {
    expect(
      decide(
        input({
          method: "POST",
          pathname: "/api/tasks",
          origin: "http://evil.com",
          cookieToken: TOKEN,
        }),
        TOKEN,
      ),
    ).toEqual({ action: "deny", status: 403, reason: "origin" });
  });

  it("allows POST with valid cookie and loopback origin", () => {
    expect(
      decide(
        input({
          method: "POST",
          pathname: "/api/tasks",
          origin: "http://127.0.0.1:3000",
          cookieToken: TOKEN,
        }),
        TOKEN,
      ),
    ).toEqual({ action: "allow" });
  });

  it("allows POST with valid cookie and null origin (curl)", () => {
    expect(
      decide(input({ method: "POST", pathname: "/api/tasks", cookieToken: TOKEN }), TOKEN),
    ).toEqual({ action: "allow" });
  });

  it("allows POST with valid Bearer token", () => {
    expect(
      decide(input({ method: "POST", pathname: "/api/tasks", bearerToken: TOKEN }), TOKEN),
    ).toEqual({ action: "allow" });
  });

  it("denies 401 token for POST with wrong bearer", () => {
    expect(
      decide(
        input({ method: "POST", pathname: "/api/tasks", bearerToken: "b".repeat(64) }),
        TOKEN,
      ),
    ).toEqual({ action: "deny", status: 401, reason: "token" });
  });

  it("denies 401 token for POST with wrong cookie and no bearer", () => {
    expect(
      decide(
        input({ method: "POST", pathname: "/api/tasks", cookieToken: "b".repeat(64) }),
        TOKEN,
      ),
    ).toEqual({ action: "deny", status: 401, reason: "token" });
  });

  it("denies 401 a page load without the cookie — the token is never handed out", () => {
    // Before: any GET / with a loopback Host received Set-Cookie: mc_session=<token>.
    expect(decide(input(), TOKEN)).toEqual({ action: "deny", status: 401, reason: "token" });
  });

  it("denies 401 a page load with a stale cookie (no silent re-issue)", () => {
    expect(decide(input({ cookieToken: "b".repeat(64) }), TOKEN)).toEqual({
      action: "deny",
      status: 401,
      reason: "token",
    });
  });

  it("bootstraps the cookie only via a valid ?token= on a page load", () => {
    expect(decide(input({ queryToken: TOKEN }), TOKEN)).toEqual({ action: "allow-set-cookie" });
    expect(decide(input({ cookieToken: "b".repeat(64), queryToken: TOKEN }), TOKEN)).toEqual({
      action: "allow-set-cookie",
    });
  });

  it("denies 401 a page load with a wrong ?token=", () => {
    expect(decide(input({ queryToken: "b".repeat(64) }), TOKEN)).toEqual({
      action: "deny",
      status: 401,
      reason: "token",
    });
  });

  it("allows a page load with the valid cookie", () => {
    expect(decide(input({ cookieToken: TOKEN }), TOKEN)).toEqual({ action: "allow" });
  });
});

describe("timingSafeEqualStr", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqualStr(TOKEN, TOKEN)).toBe(true);
  });

  it("returns false for same-length different strings", () => {
    expect(timingSafeEqualStr(TOKEN, "b".repeat(64))).toBe(false);
  });

  it("returns false on length mismatch", () => {
    expect(timingSafeEqualStr(TOKEN, TOKEN.slice(0, 63))).toBe(false);
    expect(timingSafeEqualStr("", TOKEN)).toBe(false);
  });
});
