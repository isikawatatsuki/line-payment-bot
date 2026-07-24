import { describe, expect, it } from "vitest";
import { endOfMonth, monthlyDueDate, parseMonth } from "../src/domain/date.js";
import { formatAmount, normalizeAction, parseAmount, parsePaymentInput, stripBotMention } from "../src/domain/parser.js";
import { verifyLineSignature } from "../src/line/signature.js";
import { createHmac } from "node:crypto";

describe("domain parsers", () => {
  it.each([["120000", 120000], ["120,000円", 120000], ["￥ 1,234", 1234], ["一万円", null], ["0", null]])("parses amount %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
  it("formats integer amounts", () => expect(formatAmount(120000)).toBe("120,000円"));
  it.each([["2026年7月", "2026-07-01"], ["2026/12", "2026-12-01"], ["2026年13月", null]])("parses month", (input, expected) => expect(parseMonth(input)).toBe(expected));
  it("normalizes menu variants", () => {
    expect(normalizeAction("1")).toBe("add");
    expect(normalizeAction("項目追加")).toBe("add");
    expect(normalizeAction("支払い完了")).toBe("complete");
    expect(normalizeAction("支払い項目を削除")).toBe("delete");
  });
  it("parses a payment form and mention identity", () => {
    const result = parsePaymentInput("項目名: 家賃\n開始月: 2026年7月\n終了月: 未定\n支払日: 毎月27日\n支払い者: @石川\n金額: 120000円\n希望支払い方法: 銀行振込\n備考: 共有家賃", [{ lineUserId: "U1", displayName: "石川" }]);
    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({ name: "家賃", paymentDay: 27, amount: 120000, payerLineUserId: "U1", paymentMethod: "銀行振込" });
  });
  it.each(["自分", "本人", "投稿者", "私"])("treats %s as the posting user", (payer) => {
    const result = parsePaymentInput(`項目名: 家賃\n開始月: 2026年7月\n終了月: 未定\n支払日: 毎月27日\n支払い者: ${payer}\n金額: 120000円`, [], { lineUserId: "SELF", displayName: "石川" });
    expect(result.value).toMatchObject({ payerLineUserId: "SELF", payerDisplayName: "石川" });
  });
  it("reports missing and invalid fields", () => expect(parsePaymentInput("金額: 一万円", []).errors).toEqual(expect.arrayContaining(["項目名", "開始月", "支払日", "金額", "支払い者"])));
  it("removes bot mention using LINE offsets", () => expect(stripBotMention("@BOT 支払い完了", "BOT", [{ lineUserId: "BOT", displayName: "BOT", start: 0, length: 4 }])).toBe("支払い完了"));
});

describe("date rules", () => {
  it("calculates month ends", () => { expect(endOfMonth(2024, 2)).toBe(29); expect(endOfMonth(2026, 4)).toBe(30); });
  it("clamps day 31 to month end", () => {
    expect(monthlyDueDate("2026-02-01", 31)).toBe("2026-02-28");
    expect(monthlyDueDate("2026-04-01", 31)).toBe("2026-04-30");
  });
});

it("verifies LINE HMAC signatures", () => {
  const body = '{"events":[]}'; const secret = "secret";
  const signature = createHmac("sha256", secret).update(body).digest("base64");
  expect(verifyLineSignature(body, signature, secret)).toBe(true);
  expect(verifyLineSignature(body + "x", signature, secret)).toBe(false);
});
