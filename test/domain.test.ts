import { describe, expect, it } from "vitest";
import { endOfMonth, monthlyDueDate, parseMonth } from "../src/domain/date.js";
import { formatAmount, parseAmount } from "../src/domain/parser.js";
import { verifyLineSignature } from "../src/line/signature.js";
import { createHmac } from "node:crypto";

describe("domain parsers", () => {
  it.each([["120000", 120000], ["120,000円", 120000], ["￥ 1,234", 1234], ["一万円", null], ["0", null]])("parses amount %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
  it("formats integer amounts", () => expect(formatAmount(120000)).toBe("120,000円"));
  it.each([["2026年7月", "2026-07-01"], ["2026/12", "2026-12-01"], ["2026年13月", null]])("parses month", (input, expected) => expect(parseMonth(input)).toBe(expected));
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
