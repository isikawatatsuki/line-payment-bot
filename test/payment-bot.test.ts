import { beforeEach, describe, expect, it } from "vitest";
import { PaymentBot } from "../src/application/payment-bot.js";
import { MemoryStore } from "./helpers/memory-store.js";
import type { Logger } from "../src/application/ports.js";

const logger: Logger = { info() {}, error() {} };
const now = new Date("2026-07-27T09:30:00Z");

describe("PaymentBot conversation", () => {
  let store: MemoryStore;
  let bot: PaymentBot;
  beforeEach(() => { store = new MemoryStore(); bot = new PaymentBot(store, logger); });
  const event = (overrides: Record<string, unknown> = {}) => ({ eventId: `e-${Math.random()}`, groupLineId: "G1", userLineId: "U1", userDisplayName: "石川", text: "", mentions: [], botMentioned: false, now, ...overrides });

  it("shows the menu on a bare mention", async () => expect((await bot.handleText(event({ botMentioned: true })))[0]).toContain("支払い項目を追加"));
  it("isolates conversations by user", async () => {
    await bot.handleText(event({ eventId: "1", botMentioned: true, text: "追加" }));
    await bot.handleText(event({ eventId: "2", userLineId: "U2", userDisplayName: "大谷", botMentioned: true, text: "削除" }));
    expect(store.states.size).toBe(1);
    expect([...store.states.values()][0]?.currentAction).toBe("add");
  });
  it("registers only after confirmation and suppresses duplicate webhook events", async () => {
    await bot.handleText(event({ eventId: "start", botMentioned: true, text: "追加" }));
    const form = "項目名: 家賃\n開始月: 2026年7月\n終了月: 未定\n支払日: 毎月27日\n支払い者: @石川\n金額: 120000円\n希望支払い方法: PayPay\n備考: 共有";
    const confirmation = await bot.handleText(event({ eventId: "form", text: form, mentions: [{ lineUserId: "U1", displayName: "石川" }] }));
    expect(confirmation[0]).toContain("以下の内容で登録します");
    expect(store.items).toHaveLength(0);
    expect((await bot.handleText(event({ eventId: "register", text: "登録" })))[0]).toContain("登録しました");
    expect(store.items).toHaveLength(1);
    expect(store.items[0]?.paymentMethod).toBe("PayPay");
    expect(await bot.handleText(event({ eventId: "register", text: "登録" }))).toEqual([]);
  });
  it("expires a stale conversation", async () => {
    await bot.handleText(event({ eventId: "start", botMentioned: true, text: "追加" }));
    const state = [...store.states.values()][0]!; state.expiresAt = new Date(now.getTime() - 1);
    expect((await bot.handleText(event({ eventId: "later", now: new Date(now.getTime() + 1) })))[0]).toContain("有効期限");
  });
});
