import type { Action, ParsedPaymentInput } from "./types.js";
import { parseMonth } from "./date.js";

const ACTIONS: Array<[Action, RegExp]> = [
  ["add", /^(?:1|支払い項目を?追加|項目追加|追加)$/],
  ["status", /^(?:2|支払い状況を?確認|支払い状況|状況確認|確認)$/],
  ["complete", /^(?:3|支払い完了|完了)$/],
  ["edit", /^(?:4|支払い項目を?修正|項目修正|修正)$/],
  ["delete", /^(?:5|支払い項目を?削除|項目削除|削除)$/]
];

export function normalizeAction(input: string): Action | null {
  const normalized = input.replace(/[\s　]+/g, "");
  return ACTIONS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

export function parseAmount(input: string): number | null {
  const normalized = input.replace(/[,\s　円￥¥]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

export function formatAmount(amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new Error("amount must be a safe integer");
  return `${amount.toLocaleString("ja-JP")}円`;
}

export interface Mention {
  lineUserId: string;
  displayName: string;
  start?: number;
  length?: number;
}

export function stripBotMention(text: string, botUserId: string, mentions: Mention[]): string {
  const bot = mentions.find((mention) => mention.lineUserId === botUserId);
  if (bot?.start !== undefined && bot.length !== undefined) {
    return `${text.slice(0, bot.start)}${text.slice(bot.start + bot.length)}`.trim();
  }
  return text.replace(/^@\S+\s*/, "").trim();
}

function fieldsOf(input: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:：]+)\s*[:：]\s*(.*?)\s*$/);
    if (match?.[1] && match[2] !== undefined) fields.set(match[1].trim(), match[2].trim());
  }
  return fields;
}

export function parsePaymentInput(input: string, mentions: Mention[], self?: Mention): {
  value?: ParsedPaymentInput;
  errors: string[];
} {
  const fields = fieldsOf(input);
  const errors: string[] = [];
  const name = fields.get("項目名") ?? "";
  const startMonth = parseMonth(fields.get("開始月") ?? "");
  const rawEnd = fields.get("終了月") ?? "未定";
  const endMonth = /^(?:未定|なし|-)$/.test(rawEnd) ? null : parseMonth(rawEnd);
  const rawDue = fields.get("支払日") ?? "";
  const monthly = rawDue.match(/毎月\s*(\d{1,2})\s*日/);
  const specific = rawDue.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  const amount = parseAmount(fields.get("金額") ?? "");
  const payerText = fields.get("支払い者") ?? "";
  const isSelf = /^(?:@?自分|本人|投稿者|私|わたし)$/i.test(payerText.replace(/[\s　]+/g, ""));
  const payer = isSelf ? self : mentions.find((mention) => payerText.includes(mention.displayName))
    ?? (mentions.length === 1 ? mentions[0] : undefined);

  if (!name) errors.push("項目名");
  if (!startMonth) errors.push("開始月");
  if (rawEnd !== "未定" && !endMonth) errors.push("終了月");
  if (!monthly && !specific) errors.push("支払日");
  if (monthly && (Number(monthly[1]) < 1 || Number(monthly[1]) > 31)) errors.push("支払日");
  if (!amount) errors.push("金額");
  if (!payer) errors.push("支払い者");
  if (startMonth && endMonth && endMonth < startMonth) errors.push("終了月");
  if (errors.length || !startMonth || !amount || !payer) return { errors: [...new Set(errors)] };

  const paymentDay = monthly ? Number(monthly[1]) : null;
  const specificPaymentDate = specific
    ? `${specific[1]}-${String(specific[2]).padStart(2, "0")}-${String(specific[3]).padStart(2, "0")}`
    : null;
  return {
    value: {
      name, startMonth, endMonth,
      paymentType: monthly ? "monthly" : "one_time",
      paymentDay, specificPaymentDate,
      payerLineUserId: payer.lineUserId,
      payerDisplayName: payer.displayName,
      amount,
      note: fields.get("備考") || null
    },
    errors: []
  };
}
