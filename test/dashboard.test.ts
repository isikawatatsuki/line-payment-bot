import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { parseItemForm, registerDashboardRoutes, validateDashboardConfiguration } from "../src/dashboard.js";

function itemForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe("dashboard group access", () => {
  const secret = "test-session-secret-that-is-long-enough";

  it("starts LINE Login with state, nonce and the configured callback", async () => {
    const app = new Hono();
    registerDashboardRoutes(app, {} as D1Database, secret, "login-channel", "login-secret");
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

  it("fails closed when the session secret is missing or too short", () => {
    expect(() => validateDashboardConfiguration(undefined, "login-channel", "login-secret")).toThrow("DASHBOARD_SESSION_SECRET");
    expect(() => validateDashboardConfiguration("short", "login-channel", "login-secret")).toThrow("DASHBOARD_SESSION_SECRET");
  });

  it("requires LINE Login to be configured (there is no other login method)", () => {
    expect(() => validateDashboardConfiguration(secret, undefined, undefined)).toThrow("LINE_LOGIN_CHANNEL_ID");
    expect(() => validateDashboardConfiguration(secret, "login-channel", undefined)).toThrow("LINE_LOGIN_CHANNEL_ID");
  });
});

describe("parseItemForm (貸す側 item registration form)", () => {
  const validFields = {
    name: "家賃", start_month: "2026-07", end_month: "", payment_type: "monthly", payment_day: "27",
    payer_member_id: "M1", amount: "120000", total_amount: "", payment_method: "銀行振込", note: "共有家賃"
  };

  it("accepts a valid monthly item", () => {
    const result = parseItemForm(itemForm(validFields), "G1");
    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({ groupId: "G1", name: "家賃", startMonth: "2026-07-01", paymentDay: 27, amount: 120000, payerMemberId: "M1" });
  });

  it("accepts a one-time item with a specific date", () => {
    const result = parseItemForm(itemForm({ ...validFields, payment_type: "one_time", payment_day: "", specific_payment_date: "2026-08-20" }), "G1");
    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({ paymentType: "one_time", specificPaymentDate: "2026-08-20", paymentDay: null });
  });

  it("parses an optional total_amount for remaining-balance tracking", () => {
    const result = parseItemForm(itemForm({ ...validFields, amount: "10000", total_amount: "50000" }), "G1");
    expect(result.value).toMatchObject({ amount: 10000, totalAmount: 50000 });
  });

  it("rejects a total_amount smaller than amount", () => {
    const result = parseItemForm(itemForm({ ...validFields, amount: "10000", total_amount: "5000" }), "G1");
    expect(result.errors).toEqual(expect.arrayContaining(["総額（金額以上を入力してください）"]));
  });

  it("reports missing required fields", () => {
    const result = parseItemForm(itemForm({ payment_type: "monthly" }), "G1");
    expect(result.errors).toEqual(expect.arrayContaining(["項目名", "開始月", "支払日", "支払い者", "金額"]));
  });

  it("rejects an end_month before the start_month", () => {
    const result = parseItemForm(itemForm({ ...validFields, end_month: "2026-06" }), "G1");
    expect(result.errors).toEqual(["終了月"]);
  });
});
