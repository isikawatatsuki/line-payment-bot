import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { isLoginBlocked, nextLoginFailure, registerDashboardRoutes, validateDashboardConfiguration } from "../src/dashboard.js";

describe("dashboard group access", () => {
  const secret = "test-session-secret-that-is-long-enough";
  const now = new Date("2026-07-24T05:00:00.000Z");

  it("starts LINE Login with state, nonce and the configured callback", async () => {
    const app = new Hono();
    registerDashboardRoutes(app, {} as D1Database, "test-admin-password", secret, "login-channel", "login-secret");
    const response = await app.request("https://payment.example/dashboard/line/start?group=1");
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(location.searchParams.get("client_id")).toBe("login-channel");
    expect(location.searchParams.get("redirect_uri")).toBe("https://payment.example/dashboard/line/callback");
    expect(location.searchParams.get("scope")).toBe("openid profile");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("nonce")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("fails closed when dashboard secrets are missing or too short", () => {
    expect(() => validateDashboardConfiguration(undefined, secret)).toThrow("DASHBOARD_PASSWORD");
    expect(() => validateDashboardConfiguration("short", secret)).toThrow("DASHBOARD_PASSWORD");
    expect(() => validateDashboardConfiguration("test-admin-password", "short")).toThrow("DASHBOARD_SESSION_SECRET");
  });

  it("rejects incomplete LINE Login configuration", () => {
    expect(() => validateDashboardConfiguration("test-admin-password", secret, "login-channel", "")).toThrow("configured together");
  });

  it("blocks an address after five failed admin logins", () => {
    const now = new Date("2026-07-24T06:00:00.000Z");
    let attempt = nextLoginFailure(null, now);
    for (let index = 0; index < 4; index++) attempt = nextLoginFailure(attempt, new Date(now.getTime() + index + 1));
    expect(attempt.failureCount).toBe(5);
    expect(isLoginBlocked(attempt, now)).toBe(true);
    expect(isLoginBlocked(attempt, new Date(now.getTime() + 31 * 60 * 1000))).toBe(false);
  });
});
