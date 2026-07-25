import type { D1Database } from "@cloudflare/workers-types";
import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { D1Store } from "./database/d1-store.js";
import { parseAmount } from "./domain/parser.js";
import { targetMonthOf } from "./domain/date.js";
import type { NewPaymentItem } from "./application/ports.js";

type DashboardRow = Record<string, unknown>;

const COOKIE = "payment_dashboard_session";
const OAUTH_COOKIE = "payment_dashboard_oauth";
type Session = { lineUserId: string };

export function validateDashboardConfiguration(sessionSecret: string | undefined, lineLoginChannelId: string | undefined, lineLoginChannelSecret: string | undefined): void {
  if (!sessionSecret || sessionSecret.length < 32) throw new Error("DASHBOARD_SESSION_SECRET must be at least 32 characters");
  if (!lineLoginChannelId || !lineLoginChannelSecret) throw new Error("LINE_LOGIN_CHANNEL_ID and LINE_LOGIN_CHANNEL_SECRET are required (the dashboard is LINE Login only)");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) mismatch |= (a[index % Math.max(a.length, 1)] ?? 0) ^ (b[index % Math.max(b.length, 1)] ?? 0);
  return mismatch === 0;
}

async function sessionToken(secret: string, session: Session): Promise<string> {
  const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const encodedUser = btoa(session.lineUserId).replaceAll("=", "");
  const value = `${expires}.${encodedUser}`;
  return `${value}.${await sign(value, secret)}`;
}

async function validSession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token) return null;
  const [expires, encodedUser, signature] = token.split(".");
  if (!expires || !encodedUser || !signature || Number(expires) < Date.now()) return null;
  if (!safeEqual(signature, await sign(`${expires}.${encodedUser}`, secret))) return null;
  try { return { lineUserId: atob(encodedUser) }; } catch { return null; }
}

function randomToken(bytes = 24): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return btoa(String.fromCharCode(...values)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function oauthStateToken(secret: string, groupId: string): Promise<{ state: string; nonce: string; cookie: string }> {
  const state = randomToken();
  const nonce = randomToken();
  const expires = String(Date.now() + 10 * 60 * 1000);
  const encodedGroup = btoa(groupId).replaceAll("=", "");
  const value = `${state}.${nonce}.${expires}.${encodedGroup}`;
  return { state, nonce, cookie: `${value}.${await sign(value, secret)}` };
}

async function parseOauthState(cookie: string | undefined, returnedState: string, secret: string): Promise<{ nonce: string; groupId: string } | null> {
  if (!cookie) return null;
  const [state, nonce, expires, encodedGroup, signature] = cookie.split(".");
  if (!state || !nonce || !expires || encodedGroup === undefined || !signature || state !== returnedState || Number(expires) < Date.now()) return null;
  const value = `${state}.${nonce}.${expires}.${encodedGroup}`;
  if (!safeEqual(signature, await sign(value, secret))) return null;
  try { return { nonce, groupId: atob(encodedGroup) }; } catch { return null; }
}

function monthLabel(value: string): string {
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

function yen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

interface ItemFormValues {
  name: string; startMonth: string; endMonth: string; paymentType: string; paymentDay: string;
  specificPaymentDate: string; payerMemberId: string; amount: string; totalAmount: string; paymentMethod: string; note: string;
}

export function parseItemForm(form: FormData, groupId: string): { value?: Omit<NewPaymentItem, "createdByMemberId">; errors: string[] } {
  const errors: string[] = [];
  const name = String(form.get("name") ?? "").trim();
  const startMonthRaw = String(form.get("start_month") ?? "");
  const endMonthRaw = String(form.get("end_month") ?? "");
  const paymentType = form.get("payment_type") === "one_time" ? "one_time" as const : "monthly" as const;
  const paymentDayRaw = String(form.get("payment_day") ?? "");
  const specificDateRaw = String(form.get("specific_payment_date") ?? "");
  const payerMemberId = String(form.get("payer_member_id") ?? "");
  const amount = parseAmount(String(form.get("amount") ?? ""));
  const totalAmountRaw = String(form.get("total_amount") ?? "");
  const totalAmount = totalAmountRaw ? parseAmount(totalAmountRaw) : null;
  const paymentMethod = String(form.get("payment_method") ?? "").trim() || null;
  const note = String(form.get("note") ?? "").trim() || null;

  const startMonth = /^\d{4}-\d{2}$/.test(startMonthRaw) ? `${startMonthRaw}-01` : null;
  const endMonth = endMonthRaw ? (/^\d{4}-\d{2}$/.test(endMonthRaw) ? `${endMonthRaw}-01` : null) : null;
  const paymentDay = paymentType === "monthly" ? Number(paymentDayRaw) : null;
  const specificPaymentDate = paymentType === "one_time" ? (/^\d{4}-\d{2}-\d{2}$/.test(specificDateRaw) ? specificDateRaw : null) : null;

  if (!name) errors.push("項目名");
  if (!startMonth) errors.push("開始月");
  if (endMonthRaw && !endMonth) errors.push("終了月");
  if (endMonth && startMonth && endMonth < startMonth) errors.push("終了月");
  if (paymentType === "monthly" && (!paymentDay || paymentDay < 1 || paymentDay > 31)) errors.push("支払日");
  if (paymentType === "one_time" && !specificPaymentDate) errors.push("支払日");
  if (!payerMemberId) errors.push("支払い者");
  if (!amount) errors.push("金額");
  if (totalAmountRaw && !totalAmount) errors.push("総額");
  if (amount && totalAmount && totalAmount < amount) errors.push("総額（金額以上を入力してください）");
  if (paymentMethod && paymentMethod.length > 255) errors.push("希望支払い方法（255文字以内）");
  if (errors.length) return { errors: [...new Set(errors)] };

  return {
    value: {
      groupId, name, startMonth: startMonth!, endMonth, paymentType, paymentDay, specificPaymentDate,
      payerMemberId, amount: amount!, totalAmount, paymentMethod, note
    },
    errors: []
  };
}

function formValuesFrom(form: FormData): Partial<ItemFormValues> {
  return {
    name: String(form.get("name") ?? ""), startMonth: String(form.get("start_month") ?? ""), endMonth: String(form.get("end_month") ?? ""),
    paymentType: String(form.get("payment_type") ?? "monthly"), paymentDay: String(form.get("payment_day") ?? ""),
    specificPaymentDate: String(form.get("specific_payment_date") ?? ""), payerMemberId: String(form.get("payer_member_id") ?? ""),
    amount: String(form.get("amount") ?? ""), totalAmount: String(form.get("total_amount") ?? ""),
    paymentMethod: String(form.get("payment_method") ?? ""), note: String(form.get("note") ?? "")
  };
}

function groupSwitcher(groups: DashboardRow[], groupId: string, action: string): string {
  const options = groups.map((value) => `<option value="${escapeHtml(value.id)}"${String(value.id) === groupId ? " selected" : ""}>${escapeHtml(value.display_name)}</option>`).join("");
  return `<form method="get" action="${action}"><label class="sr-only" for="group">グループ</label><select class="select" id="group" name="group" onchange="this.form.submit()">${options}</select></form>`;
}

function itemFormPage(title: string, action: string, groupId: string, members: DashboardRow[], values: Partial<ItemFormValues>, errors: string[] = []): string {
  const memberOptions = members.map((m) => `<option value="${escapeHtml(m.id)}"${String(m.id) === values.payerMemberId ? " selected" : ""}>${escapeHtml(m.display_name)}</option>`).join("");
  const errorBox = errors.length ? `<div class="error" role="alert">次の項目を確認してください：${errors.map(escapeHtml).join("、")}</div>` : "";
  return pageShell(title, `<main class="wrap"><header class="topbar"><div><div class="eyebrow">PAYMENT ANALYTICS</div><h1 class="title">${escapeHtml(title)}</h1></div></header>
    <section class="grid"><article class="card" style="grid-column:1/-1">${errorBox}
    <form method="post" action="${action}">
      <div class="field"><label for="name">項目名</label><input id="name" name="name" required value="${escapeHtml(values.name ?? "")}"></div>
      <div class="field"><label for="start_month">開始月</label><input id="start_month" name="start_month" type="month" required value="${escapeHtml(values.startMonth ?? "")}"></div>
      <div class="field"><label for="end_month">終了月（空欄で未定）</label><input id="end_month" name="end_month" type="month" value="${escapeHtml(values.endMonth ?? "")}"></div>
      <div class="field"><label>支払いサイクル</label>
        <div class="radio-row">
          <label><input type="radio" name="payment_type" value="monthly"${values.paymentType !== "one_time" ? " checked" : ""}> 毎月</label>
          <label><input type="radio" name="payment_type" value="one_time"${values.paymentType === "one_time" ? " checked" : ""}> 単発</label>
        </div>
      </div>
      <div class="field"><label for="payment_day">支払日（毎月・1〜31）</label><input id="payment_day" name="payment_day" type="number" min="1" max="31" value="${escapeHtml(values.paymentDay ?? "")}"></div>
      <div class="field"><label for="specific_payment_date">支払日（単発）</label><input id="specific_payment_date" name="specific_payment_date" type="date" value="${escapeHtml(values.specificPaymentDate ?? "")}"></div>
      <div class="field"><label for="payer_member_id">支払い者</label><select class="select" id="payer_member_id" name="payer_member_id" required><option value="">選択してください</option>${memberOptions}</select></div>
      <div class="field"><label for="amount">金額</label><input id="amount" name="amount" type="number" min="1" required value="${escapeHtml(values.amount ?? "")}"></div>
      <div class="field"><label for="total_amount">総額（任意・分割払いの残金表示に使用）</label><input id="total_amount" name="total_amount" type="number" min="1" value="${escapeHtml(values.totalAmount ?? "")}"></div>
      <div class="field"><label for="payment_method">希望支払い方法（任意）</label><input id="payment_method" name="payment_method" value="${escapeHtml(values.paymentMethod ?? "")}"></div>
      <div class="field"><label for="note">備考（任意）</label><input id="note" name="note" value="${escapeHtml(values.note ?? "")}"></div>
      <input type="hidden" name="group" value="${escapeHtml(groupId)}">
      <button class="button" type="submit">保存</button>
      <a href="/dashboard/items?group=${encodeURIComponent(groupId)}">戻る</a>
    </form>
    </article></section></main>`);
}

function pageShell(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title><style>
  :root{--ink:#201d2a;--muted:#6f6a7a;--line:#e9e6ee;--surface:#fff;--canvas:#f7f6f9;--purple:#6d3ee8;--purple-2:#8b66ef;--soft:#eee9ff;--success:#18866b;--danger:#c44b62;--shadow:0 16px 40px rgba(42,28,73,.08)}
  *{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font-family:"Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif;line-height:1.55}button,input,select{font:inherit}a{color:inherit}.wrap{width:min(1180px,calc(100% - 32px));margin:auto;padding:36px 0 56px}.topbar{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:28px}.eyebrow{color:var(--purple);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.title{font-size:clamp(28px,4vw,44px);line-height:1.18;margin:8px 0 6px;letter-spacing:-.03em}.sub{color:var(--muted);margin:0;font-size:15px}.controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}.select{min-height:44px;border:1px solid var(--line);border-radius:12px;background:#fff;padding:0 38px 0 14px;color:var(--ink)}.button{min-height:44px;border:0;border-radius:12px;padding:0 16px;background:var(--ink);color:#fff;font-weight:700;cursor:pointer}.button:hover{background:#373141}.button:focus-visible,.select:focus-visible,input:focus-visible{outline:3px solid rgba(109,62,232,.25);outline-offset:2px}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:18px}.card{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:var(--shadow)}.kpi{grid-column:span 3;min-height:138px}.kpi-label{font-size:13px;color:var(--muted);font-weight:700}.kpi-value{font-size:clamp(25px,3vw,36px);font-weight:800;letter-spacing:-.04em;margin-top:14px}.kpi-note{font-size:12px;color:var(--muted);margin-top:5px}.trend{grid-column:span 8}.status{grid-column:span 4}.items{grid-column:span 7}.payers{grid-column:span 5}.balances{grid-column:1/-1}.card-title{font-size:18px;margin:0}.card-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.legend{font-size:12px;color:var(--muted)}canvas{display:block;width:100%;height:250px}.donut-wrap{display:grid;place-items:center;min-height:250px}.donut{width:176px;height:176px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--purple) 0 var(--progress),var(--soft) var(--progress) 100%);position:relative}.donut:after{content:"";position:absolute;inset:24px;background:#fff;border-radius:50%}.donut-copy{position:relative;z-index:1;text-align:center}.donut-value{font-size:32px;font-weight:800}.bar-list{display:grid;gap:16px}.bar-row{display:grid;grid-template-columns:minmax(90px,1fr) 3fr auto;gap:14px;align-items:center}.bar-name{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bar-track{height:10px;border-radius:999px;background:var(--soft);overflow:hidden}.bar-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--purple),var(--purple-2))}.bar-value{font-size:13px;font-weight:700;min-width:86px;text-align:right}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:13px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{color:var(--muted);font-size:12px}td:last-child,th:last-child{text-align:right}.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700}.badge:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--success)}.badge.pending:before{background:var(--purple-2)}.empty{grid-column:1/-1;text-align:center;padding:64px 24px}.empty-mark{width:54px;height:54px;margin:0 auto 18px;border-radius:16px;background:var(--soft);display:grid;place-items:center;color:var(--purple);font-size:24px;font-weight:900}.login{min-height:100vh;display:grid;place-items:center;padding:24px}.login-card{width:min(440px,100%);background:#fff;border:1px solid var(--line);border-radius:22px;padding:34px;box-shadow:var(--shadow)}.login-card h1{font-size:28px;margin:8px 0}.field{display:grid;gap:8px;margin:26px 0 16px}.field>label{font-size:13px;font-weight:700}.field input{width:100%;min-height:48px;border:1px solid var(--line);border-radius:12px;padding:0 14px}.field input[type=radio]{width:auto;min-height:auto;border:0;padding:0}.radio-row{display:flex;gap:20px}.radio-row label{display:flex;align-items:center;gap:6px;font-size:15px;font-weight:400}.error{background:#fff0f3;color:#952c42;padding:11px 13px;border-radius:10px;font-size:13px;margin-top:14px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .line-button{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:12px;background:#06c755;color:#fff;text-decoration:none;font-weight:800;margin-top:24px}.line-button:hover{background:#05b94e}
  @media(max-width:900px){.kpi{grid-column:span 6}.trend,.status,.items,.payers{grid-column:1/-1}.topbar{flex-direction:column}.controls{justify-content:flex-start}}
  @media(max-width:520px){.wrap{width:min(100% - 20px,1180px);padding-top:24px}.kpi{grid-column:1/-1}.card{padding:18px}.bar-row{grid-template-columns:1fr auto}.bar-track{grid-column:1/-1;grid-row:2}.title{font-size:30px}}
  @media(prefers-reduced-motion:no-preference){.card{animation:rise .35s ease both}@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
  </style></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function loginPage(error = false, groupId = ""): string {
  const groupQuery = groupId ? `?group=${encodeURIComponent(groupId)}` : "";
  return pageShell("支払いダッシュボード - ログイン", `<main class="login"><section class="login-card"><div class="eyebrow">PAYMENT ANALYTICS</div><h1>支払いダッシュボード</h1><p class="sub">LINEアカウントで本人確認してログインします。</p>${error ? '<div class="error" role="alert">ログインに失敗しました。もう一度お試しください。</div>' : ""}<a class="line-button" href="/dashboard/line/start${groupQuery}">LINEでログイン</a><p class="kpi-note">グループのメンバーであれば、支払い項目の管理（貸与ページ）と自分の支払い状況の確認・完了（返済ページ）の両方を行えます。</p></section></main>`);
}

export function registerDashboardRoutes(app: Hono, db: D1Database, sessionSecret: string, lineLoginChannelId: string, lineLoginChannelSecret: string): void {
  validateDashboardConfiguration(sessionSecret, lineLoginChannelId, lineLoginChannelSecret);
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Strict-Transport-Security", "max-age=31536000");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
  });

  const myGroups = (lineUserId: string) => db.prepare("SELECT DISTINCT lg.id, COALESCE(lg.display_name, 'LINEグループ') AS display_name FROM line_groups lg JOIN line_members lm ON lm.group_id = lg.id WHERE lg.is_active = 1 AND lm.is_active = 1 AND lm.line_user_id = ? ORDER BY lg.id").bind(lineUserId).all<DashboardRow>();
  const activeMembers = (groupId: string) => db.prepare("SELECT id, display_name FROM line_members WHERE group_id = ? AND is_active = 1 ORDER BY display_name").bind(groupId).all<DashboardRow>();

  app.get("/", (c) => c.redirect("/dashboard"));
  app.get("/dashboard/login", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (session) return c.redirect("/dashboard");
    return c.html(loginPage(c.req.query("error") === "1", c.req.query("group") ?? ""));
  });
  app.get("/dashboard/line/start", async (c) => {
    const groupId = c.req.query("group") ?? "";
    const state = await oauthStateToken(sessionSecret, groupId);
    setCookie(c, OAUTH_COOKIE, state.cookie, { httpOnly: true, secure: true, sameSite: "Lax", path: "/dashboard/line", maxAge: 600 });
    const redirectUri = `${new URL(c.req.url).origin}/dashboard/line/callback`;
    const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", lineLoginChannelId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", state.state);
    authorize.searchParams.set("scope", "openid profile");
    authorize.searchParams.set("nonce", state.nonce);
    return c.redirect(authorize.toString());
  });
  app.get("/dashboard/line/callback", async (c) => {
    const state = await parseOauthState(getCookie(c, OAUTH_COOKIE), c.req.query("state") ?? "", sessionSecret);
    deleteCookie(c, OAUTH_COOKIE, { path: "/dashboard/line" });
    const code = c.req.query("code") ?? "";
    if (!state || !code || c.req.query("error")) return c.redirect("/dashboard/login?error=1");
    const redirectUri = `${new URL(c.req.url).origin}/dashboard/line/callback`;
    const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: lineLoginChannelId, client_secret: lineLoginChannelSecret })
    });
    if (!tokenResponse.ok) return c.redirect("/dashboard/login?error=1");
    const token = await tokenResponse.json() as { id_token?: string };
    if (!token.id_token) return c.redirect("/dashboard/login?error=1");
    const verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token.id_token, client_id: lineLoginChannelId, nonce: state.nonce })
    });
    if (!verifyResponse.ok) return c.redirect("/dashboard/login?error=1");
    const identity = await verifyResponse.json() as { sub?: string };
    if (!identity.sub) return c.redirect("/dashboard/login?error=1");
    const membership = await db.prepare("SELECT group_id FROM line_members WHERE line_user_id = ? AND is_active = 1 ORDER BY CASE WHEN group_id = ? THEN 0 ELSE 1 END LIMIT 1").bind(identity.sub, state.groupId).first<{ group_id: string | number }>();
    if (!membership) return c.redirect("/dashboard/login?error=1");
    setCookie(c, COOKIE, await sessionToken(sessionSecret, { lineUserId: identity.sub }), { httpOnly: true, secure: true, sameSite: "Lax", path: "/dashboard", maxAge: 604800 });
    return c.redirect(`/dashboard?group=${encodeURIComponent(String(membership.group_id))}`, 303);
  });
  app.post("/dashboard/logout", (c) => { deleteCookie(c, COOKIE, { path: "/dashboard" }); return c.redirect("/dashboard/login", 303); });

  // 返済ページ: the logged-in member's own payment status and completion action.
  app.get("/dashboard", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (!session) return c.redirect("/dashboard/login");
    const groups = (await myGroups(session.lineUserId)).results;
    const requestedGroup = c.req.query("group");
    const group = groups.find((value) => String(value.id) === requestedGroup) ?? groups[0];
    const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date()) + "-01";
    const requestedMonth = c.req.query("month") ?? "";
    const selectedMonth = /^\d{4}-\d{2}$/.test(requestedMonth)
      ? `${requestedMonth}-01`
      : /^\d{4}-\d{2}-01$/.test(requestedMonth) ? requestedMonth : currentMonth;
    if (!group) return c.html(pageShell("支払いダッシュボード", `<main class="wrap"><div class="topbar"><div><div class="eyebrow">PAYMENT ANALYTICS</div><h1 class="title">支払いダッシュボード</h1><p class="sub">BOTをLINEグループへ追加してください。</p></div><form method="post" action="/dashboard/logout"><button class="button">ログアウト</button></form></div><section class="grid"><div class="card empty"><div class="empty-mark">0</div><h2>表示できるグループがありません</h2><p class="sub">LINEグループにBOTを追加すると、ここにグループが表示されます。支払い項目はこのダッシュボードから登録してください。</p></div></section></main>`));

    const groupId = String(group.id);
    const lineUserId = session.lineUserId;
    const trend = (await db.prepare(`SELECT pr.target_month, SUM(pr.amount_snapshot) AS total, SUM(CASE WHEN pr.status = 'paid' THEN pr.amount_snapshot ELSE 0 END) AS paid FROM payment_records pr JOIN line_members lm ON lm.id = pr.payer_member_id WHERE pr.group_id = ? AND lm.line_user_id = ? GROUP BY pr.target_month ORDER BY pr.target_month DESC LIMIT 12`).bind(groupId, lineUserId).all<DashboardRow>()).results.reverse();
    let details = (await db.prepare(`SELECT pr.item_name_snapshot AS name, pr.amount_snapshot AS amount, pr.payment_method_snapshot AS method, pr.status, lm.display_name AS payer FROM payment_records pr JOIN line_members lm ON lm.id = pr.payer_member_id WHERE pr.group_id = ? AND pr.target_month = ? AND lm.line_user_id = ? ORDER BY pr.amount_snapshot DESC`).bind(groupId, selectedMonth, lineUserId).all<DashboardRow>()).results;
    if (!details.length) details = (await db.prepare(`SELECT pi.name, pi.amount, pi.payment_method AS method, 'planned' AS status, lm.display_name AS payer FROM payment_items pi JOIN line_members lm ON lm.id = pi.payer_member_id WHERE pi.group_id = ? AND lm.line_user_id = ? AND pi.is_active = 1 AND pi.start_month <= ? AND (pi.end_month IS NULL OR pi.end_month >= ?) AND (pi.payment_type = 'monthly' OR (pi.payment_type = 'one_time' AND substr(pi.specific_payment_date, 1, 7) = substr(?, 1, 7))) ORDER BY pi.amount DESC`).bind(groupId, lineUserId, selectedMonth, selectedMonth, selectedMonth).all<DashboardRow>()).results;
    const balances = (await db.prepare(`SELECT pi.id, pi.name, pi.total_amount AS total_amount, COALESCE(SUM(CASE WHEN pr.status = 'paid' THEN pr.amount_snapshot ELSE 0 END), 0) AS paid_total FROM payment_items pi JOIN line_members lm ON lm.id = pi.payer_member_id LEFT JOIN payment_records pr ON pr.payment_item_id = pi.id WHERE pi.group_id = ? AND pi.is_active = 1 AND pi.total_amount IS NOT NULL AND lm.line_user_id = ? GROUP BY pi.id ORDER BY pi.id`).bind(groupId, lineUserId).all<DashboardRow>()).results;
    const total = details.reduce((sum, row) => sum + Number(row.amount), 0);
    const paid = details.filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount), 0);
    const pending = Math.max(total - paid, 0);
    const rate = total ? Math.round(paid / total * 100) : 0;
    const itemMap = new Map<string, { name: string; method: string; amount: number }>();
    for (const row of details) { const name = String(row.name); const method = String(row.method ?? ""); const key = `${name} ${method}`; const value = itemMap.get(key) ?? { name, method, amount: 0 }; value.amount += Number(row.amount); itemMap.set(key, value); }
    const itemTotals = [...itemMap.values()].sort((a,b) => b.amount-a.amount);
    const payerMap = new Map<string, { total: number; paid: number }>();
    for (const row of details) { const name = String(row.payer); const value = payerMap.get(name) ?? { total: 0, paid: 0 }; value.total += Number(row.amount); if (row.status === "paid") value.paid += Number(row.amount); payerMap.set(name, value); }
    const maxItem = Math.max(...itemTotals.map((value) => value.amount), 1);
    const itemBars = itemTotals.length ? itemTotals.map((value) => `<div class="bar-row"><div><div class="bar-name" title="${escapeHtml(value.name)}">${escapeHtml(value.name)}</div>${value.method ? `<div class="kpi-note">希望: ${escapeHtml(value.method)}</div>` : ""}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(value.amount / maxItem * 100, 3)}%"></div></div><div class="bar-value">${yen(value.amount)}</div></div>`).join("") : '<p class="sub">この月の項目はありません。</p>';
    const payerRows = payerMap.size ? [...payerMap].map(([name,value]) => `<tr><td>${escapeHtml(name)}</td><td><span class="badge ${value.paid < value.total ? "pending" : ""}">${value.paid >= value.total ? "完了" : "支払い待ち"}</span></td><td>${yen(value.total)}</td></tr>`).join("") : '<tr><td colspan="3" class="sub">データがありません。</td></tr>';
    const balanceRows = balances.map((row) => {
      const totalAmount = Number(row.total_amount);
      const paidTotal = Number(row.paid_total);
      const remaining = Math.max(totalAmount - paidTotal, 0);
      const progress = totalAmount ? Math.min(Math.round(paidTotal / totalAmount * 100), 100) : 0;
      return `<tr><td>${escapeHtml(row.name)}</td><td>${yen(totalAmount)}</td><td>${yen(paidTotal)}</td><td>${yen(remaining)}</td><td>${progress}%</td></tr>`;
    }).join("");
    const balanceCard = balances.length ? `<article class="card balances"><div class="card-head"><h2 class="card-title">総額・残金</h2><span class="legend">${balances.length}項目</span></div><div class="table-wrap"><table><thead><tr><th>項目名</th><th>総額</th><th>支払い済み</th><th>残金</th><th>進捗</th></tr></thead><tbody>${balanceRows}</tbody></table></div></article>` : "";
    const hasPending = details.some((row) => row.status === "pending");
    const actionCard = `<article class="card" style="grid-column:1/-1"><div class="controls" style="justify-content:flex-start"><a class="button" href="/dashboard/items?group=${encodeURIComponent(groupId)}">支払い項目を管理する（貸与ページ）</a>${hasPending ? `<form method="post" action="/dashboard/records/complete" onsubmit="return confirm('今月の支払いを完了にしますか？')"><input type="hidden" name="group" value="${escapeHtml(groupId)}"><input type="hidden" name="month" value="${escapeHtml(selectedMonth)}"><button class="button" type="submit">今月の支払いを完了にする</button></form>` : ""}</div></article>`;
    const chartData = JSON.stringify(trend.map((row) => ({ label: monthLabel(String(row.target_month)), total: Number(row.total), paid: Number(row.paid) }))).replaceAll("<", "\\u003c");
    const body = `<main class="wrap"><header class="topbar"><div><div class="eyebrow">PAYMENT ANALYTICS</div><h1 class="title">支払いダッシュボード</h1><p class="sub">${escapeHtml(group.display_name)} / ${monthLabel(selectedMonth)}</p></div><div class="controls">${groupSwitcher(groups, groupId, "/dashboard")}<form method="get" action="/dashboard"><input type="hidden" name="group" value="${escapeHtml(groupId)}"><label class="sr-only" for="month">対象月</label><input class="select" id="month" name="month" type="month" value="${selectedMonth.slice(0,7)}" onchange="this.form.submit()"></form><form method="post" action="/dashboard/logout"><button class="button" type="submit">ログアウト</button></form></div></header><section class="grid">${actionCard}<article class="card kpi"><div class="kpi-label">対象金額</div><div class="kpi-value">${yen(total)}</div><div class="kpi-note">登録項目の合計</div></article><article class="card kpi"><div class="kpi-label">支払い済み</div><div class="kpi-value">${yen(paid)}</div><div class="kpi-note">完了として記録</div></article><article class="card kpi"><div class="kpi-label">支払い待ち</div><div class="kpi-value">${yen(pending)}</div><div class="kpi-note">未完了・予定分</div></article><article class="card kpi"><div class="kpi-label">完了率</div><div class="kpi-value">${rate}%</div><div class="kpi-note">金額ベース</div></article><article class="card trend"><div class="card-head"><h2 class="card-title">月別の支払い推移</h2><span class="legend">総額 / 支払い済み</span></div><canvas id="trendChart" width="720" height="250" role="img" aria-label="月別支払い推移グラフ"></canvas><div id="trendFallback" class="sr-only"></div></article><article class="card status"><div class="card-head"><h2 class="card-title">支払い状況</h2></div><div class="donut-wrap"><div class="donut" style="--progress:${rate}%"><div class="donut-copy"><div class="donut-value">${rate}%</div><div class="kpi-note">完了</div></div></div></div></article><article class="card items"><div class="card-head"><h2 class="card-title">項目別の内訳</h2><span class="legend">${itemTotals.length}項目</span></div><div class="bar-list">${itemBars}</div></article><article class="card payers"><div class="card-head"><h2 class="card-title">支払い者別</h2></div><div class="table-wrap"><table><thead><tr><th>支払い者</th><th>状態</th><th>金額</th></tr></thead><tbody>${payerRows}</tbody></table></div></article>${balanceCard}</section></main>`;
    const script = `const data=${chartData};const canvas=document.getElementById('trendChart');const ctx=canvas.getContext('2d');const dpr=Math.min(devicePixelRatio||1,2);function draw(){const rect=canvas.getBoundingClientRect();canvas.width=rect.width*dpr;canvas.height=250*dpr;ctx.scale(dpr,dpr);const w=rect.width,h=250,p={l:50,r:12,t:12,b:36};ctx.clearRect(0,0,w,h);ctx.font='12px sans-serif';ctx.fillStyle='#77717f';if(!data.length){ctx.textAlign='center';ctx.fillText('支払い実績が作成されると推移を表示します',w/2,h/2);return}const max=Math.max(...data.map(x=>x.total),1);const step=(w-p.l-p.r)/Math.max(data.length,1);[0,.5,1].forEach(v=>{const y=p.t+(h-p.t-p.b)*(1-v);ctx.strokeStyle='#ece9f0';ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.textAlign='right';ctx.fillStyle='#77717f';ctx.fillText(Math.round(max*v/1000)+'k',p.l-8,y+4)});data.forEach((x,i)=>{const x0=p.l+i*step+step*.18,bw=step*.28;const totalH=(h-p.t-p.b)*x.total/max,paidH=(h-p.t-p.b)*x.paid/max;ctx.fillStyle='#eee9ff';ctx.fillRect(x0,h-p.b-totalH,bw,totalH);ctx.fillStyle='#6d3ee8';ctx.fillRect(x0+bw+3,h-p.b-paidH,bw,paidH);ctx.fillStyle='#77717f';ctx.textAlign='center';ctx.fillText(x.label.replace(/\\d{4}年/,''),x0+bw,h-13)});document.getElementById('trendFallback').textContent=data.map(x=>x.label+' 総額 '+x.total+'円 支払い済み '+x.paid+'円').join('、')}draw();addEventListener('resize',draw,{passive:true});`;
    return c.html(pageShell("支払いダッシュボード", body, script));
  });

  // 貸与ページ: item registration/editing, open to any logged-in member of the group.
  app.get("/dashboard/items", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (!session) return c.redirect("/dashboard/login");
    const groups = (await myGroups(session.lineUserId)).results;
    const requestedGroup = c.req.query("group");
    const group = groups.find((value) => String(value.id) === requestedGroup) ?? groups[0];
    if (!group) return c.redirect("/dashboard");
    const groupId = String(group.id);
    const items = await new D1Store(db).listActiveItems(groupId);
    const memberNames = new Map((await activeMembers(groupId)).results.map((m) => [String(m.id), String(m.display_name)]));
    const rows = items.length ? items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(memberNames.get(item.payerMemberId) ?? "不明")}</td><td>${yen(item.amount)}</td><td>${item.totalAmount ? yen(item.totalAmount) : "-"}</td><td><a href="/dashboard/items/${item.id}/edit?group=${encodeURIComponent(groupId)}">編集</a> <form method="post" action="/dashboard/items/${item.id}/delete" style="display:inline" onsubmit="return confirm('無効化しますか？')"><input type="hidden" name="group" value="${escapeHtml(groupId)}"><button type="submit">削除</button></form></td></tr>`).join("") : '<tr><td colspan="5" class="sub">支払い項目はまだありません。</td></tr>';
    const body = `<main class="wrap"><header class="topbar"><div><div class="eyebrow">PAYMENT ANALYTICS</div><h1 class="title">支払い項目の管理</h1></div><div class="controls">${groupSwitcher(groups, groupId, "/dashboard/items")}<a class="button" href="/dashboard/items/new?group=${encodeURIComponent(groupId)}">新規登録</a><a href="/dashboard?group=${encodeURIComponent(groupId)}">ダッシュボードへ戻る</a></div></header><section class="grid"><article class="card" style="grid-column:1/-1"><div class="table-wrap"><table><thead><tr><th>項目名</th><th>支払い者</th><th>金額</th><th>総額</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></article></section></main>`;
    return c.html(pageShell("支払い項目の管理", body));
  });

  app.get("/dashboard/items/new", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (!session) return c.redirect("/dashboard/login");
    const groupId = c.req.query("group") ?? "";
    if (!await new D1Store(db).findMember(groupId, session.lineUserId)) return c.redirect("/dashboard");
    return c.html(itemFormPage("支払い項目の新規登録", "/dashboard/items/new", groupId, (await activeMembers(groupId)).results, {}));
  });

  app.post("/dashboard/items/new", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (!session) return c.redirect("/dashboard/login");
    const form = await c.req.formData();
    const groupId = String(form.get("group") ?? "");
    const store = new D1Store(db);
    const member = await store.findMember(groupId, session.lineUserId);
    if (!member) return c.redirect("/dashboard");
    const parsed = parseItemForm(form, groupId);
    if (!parsed.value) return c.html(itemFormPage("支払い項目の新規登録", "/dashboard/items/new", groupId, (await activeMembers(groupId)).results, formValuesFrom(form), parsed.errors));
    await store.createItem({ ...parsed.value, createdByMemberId: member.id });
    return c.redirect(`/dashboard/items?group=${encodeURIComponent(groupId)}`, 303);
  });

  app.get("/dashboard/items/:id/edit", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (!session) return c.redirect("/dashboard/login");
    const groupId = c.req.query("group") ?? "";
    if (!await new D1Store(db).findMember(groupId, session.lineUserId)) return c.redirect("/dashboard");
    const item = await new D1Store(db).findItem(c.req.param("id"));
    if (!item || item.groupId !== groupId) return c.redirect(`/dashboard/items?group=${encodeURIComponent(groupId)}`);
    const values: Partial<ItemFormValues> = {
      name: item.name, startMonth: item.startMonth.slice(0, 7), endMonth: item.endMonth ? item.endMonth.slice(0, 7) : "",
      paymentType: item.paymentType, paymentDay: item.paymentDay ? String(item.paymentDay) : "",
      specificPaymentDate: item.specificPaymentDate ?? "", payerMemberId: item.payerMemberId,
      amount: String(item.amount), totalAmount: item.totalAmount ? String(item.totalAmount) : "",
      paymentMethod: item.paymentMethod ?? "", note: item.note ?? ""
    };
    return c.html(itemFormPage("支払い項目の編集", `/dashboard/items/${item.id}/edit`, groupId, (await activeMembers(groupId)).results, values));
  });

  app.post("/dashboard/items/:id/edit", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (!session) return c.redirect("/dashboard/login");
    const itemId = c.req.param("id");
    const form = await c.req.formData();
    const groupId = String(form.get("group") ?? "");
    const store = new D1Store(db);
    if (!await store.findMember(groupId, session.lineUserId)) return c.redirect("/dashboard");
    const existing = await store.findItem(itemId);
    if (!existing || existing.groupId !== groupId) return c.redirect(`/dashboard/items?group=${encodeURIComponent(groupId)}`);
    const parsed = parseItemForm(form, groupId);
    if (!parsed.value) return c.html(itemFormPage("支払い項目の編集", `/dashboard/items/${itemId}/edit`, groupId, (await activeMembers(groupId)).results, formValuesFrom(form), parsed.errors));
    await store.updateItem(itemId, parsed.value);
    return c.redirect(`/dashboard/items?group=${encodeURIComponent(groupId)}`, 303);
  });

  app.post("/dashboard/items/:id/delete", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (!session) return c.redirect("/dashboard/login");
    const form = await c.req.formData();
    const groupId = String(form.get("group") ?? "");
    const store = new D1Store(db);
    if (!await store.findMember(groupId, session.lineUserId)) return c.redirect("/dashboard");
    const existing = await store.findItem(c.req.param("id"));
    if (existing && existing.groupId === groupId) await store.deactivateItem(c.req.param("id"));
    return c.redirect(`/dashboard/items?group=${encodeURIComponent(groupId)}`, 303);
  });

  // 返済ページ: mark this month's own pending payments as paid.
  app.post("/dashboard/records/complete", async (c) => {
    const session = await validSession(getCookie(c, COOKIE), sessionSecret);
    if (!session) return c.redirect("/dashboard/login");
    const form = await c.req.formData();
    const groupId = String(form.get("group") ?? "");
    const month = String(form.get("month") ?? targetMonthOf(new Date()));
    const store = new D1Store(db);
    const member = await store.findMember(groupId, session.lineUserId);
    if (member) {
      const pendingIds = (await store.listRecords(groupId, month, member.id)).filter((r) => r.status === "pending").map((r) => r.id);
      if (pendingIds.length) await store.markPaid(pendingIds, member.id, new Date());
    }
    return c.redirect(`/dashboard?group=${encodeURIComponent(groupId)}&month=${encodeURIComponent(month.slice(0, 7))}`, 303);
  });
}
