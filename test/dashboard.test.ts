import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { registerDashboardRoutes } from "../src/dashboard.js";

describe("dashboard group access", () => {
  const secret = "test-session-secret-that-is-long-enough";
  const now = new Date("2026-07-24T05:00:00.000Z");

  it("starts LINE Login with state, nonce and the configured callback", async () => {
    const app = new Hono();
    registerDashboardRoutes(app, {} as D1Database, "admin", secret, "login-channel", "login-secret");
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
  });
});
