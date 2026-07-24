import type { PaymentItem, PaymentRecord } from "../domain/types.js";
import { formatAmount } from "../domain/parser.js";
import { formatJst, formatMonth } from "../domain/date.js";

export const menu = (name: string) => `@${name}\n\n操作内容を送信してください。\n\n1. 支払い項目を追加\n2. 支払い状況を確認\n3. 支払い完了\n4. 支払い項目を修正\n5. 支払い項目を削除\n6. ダッシュボードを開く`;

export const addForm = (name: string) => `@${name}\n\n以下のフォーマットで送信してください。\n\n項目名:\n開始月:\n終了月:\n支払日:\n支払い者:\n金額:\n希望支払い方法:（任意）\n備考:\n\n【入力例】\n項目名: 家賃\n開始月: 2026年7月\n終了月: 未定\n支払日: 毎月27日\n支払い者: @石川\n金額: 120000円\n希望支払い方法: 銀行振込\n備考: 共有家賃`;

export function itemConfirmation(data: Record<string, unknown>): string {
  const end = data.endMonth ? `から${formatMonth(String(data.endMonth))}まで` : "から毎月";
  const due = data.paymentType === "monthly" ? `毎月${data.paymentDay}日` : String(data.specificPaymentDate);
  return `以下の内容で登録します。\n\n項目名: ${data.name}\n期間: ${formatMonth(String(data.startMonth))}${end}\n支払日: ${due}\n支払い者: @${data.payerDisplayName}\n金額: ${formatAmount(Number(data.amount))}\n希望支払い方法: ${data.paymentMethod || "指定なし"}\n備考: ${data.note || "なし"}\n\n問題なければ「登録」と送信してください。\n修正する場合は「修正」と送信してください。\nキャンセルする場合は「キャンセル」と送信してください。`;
}

export function recordSummary(records: PaymentRecord[], memberName: string, targetMonth: string): string {
  const total = records.reduce((sum, record) => sum + record.amountSnapshot, 0);
  const lines = records.map((record) => `${record.itemNameSnapshot}　${formatAmount(record.amountSnapshot)}　${record.status === "paid" ? "完了" : "未完了"}${record.paymentMethodSnapshot ? `\n　希望支払い方法: ${record.paymentMethodSnapshot}` : ""}`);
  const status = records.every((record) => record.status === "paid") ? "支払い完了" : "支払い待ち";
  const due = records[0]?.dueDate ?? "-";
  return `📋 ${formatMonth(targetMonth)} 支払い状況\n\n@${memberName}\n合計：${formatAmount(total)}\n状態：${status}\n期限：${due.replaceAll("-", "年").replace(/年(\d{2})年/, "年$1月")}日\n\n【内訳】\n${lines.join("\n")}`;
}

function notificationDetails(records: PaymentRecord[]): string {
  const total = records.reduce((sum, record) => sum + record.amountSnapshot, 0);
  const lines = records.map((record) => `${record.itemNameSnapshot}　${formatAmount(record.amountSnapshot)}${record.paymentMethodSnapshot ? `\n　希望支払い方法: ${record.paymentMethodSnapshot}` : ""}`);
  return `合計：${formatAmount(total)}\n\n【内訳】\n${lines.join("\n")}\n\n支払期限：${records[0]?.dueDate}`;
}

export function paymentRequestNotification(records: PaymentRecord[], memberName: string): string {
  const month = records[0]?.targetMonth ?? "";
  return `@${memberName}\n\n📨 ${formatMonth(month)} 支払い依頼\n\n${notificationDetails(records)}\n\n期限の3日前です。支払いをお願いします。`;
}

export function dueDateNotification(records: PaymentRecord[], memberName: string): string {
  const month = records[0]?.targetMonth ?? "";
  return `@${memberName}\n\n⏰ ${formatMonth(month)} 本日が支払期限です\n\n${notificationDetails(records)}\n\n支払いが完了したら、\n@支払いBOT をメンションして\n「支払い完了」と送信してください。`;
}

export function overdueNotification(records: PaymentRecord[], memberName: string, daysLate: number): string {
  return `@${memberName}\n\n⚠️ 支払い期限を${daysLate}日超過しています\n\n${notificationDetails(records)}\n\n支払い状況を確認してください。`;
}

export function completionConfirmation(records: PaymentRecord[]): string {
  const total = records.reduce((sum, record) => sum + record.amountSnapshot, 0);
  const lines = records.map((record) => `${record.itemNameSnapshot}　${formatAmount(record.amountSnapshot)}${record.paymentMethodSnapshot ? `\n　希望支払い方法: ${record.paymentMethodSnapshot}` : ""}`);
  return `以下の支払いを完了にします。\n\n対象月：${formatMonth(records[0]!.targetMonth)}\n合計：${formatAmount(total)}\n\n【内訳】\n${lines.join("\n")}\n\n問題なければ「完了」と送信してください。`;
}

export function completionDone(records: PaymentRecord[], now: Date): string {
  const total = records.reduce((sum, record) => sum + record.amountSnapshot, 0);
  return `✅ 支払い完了\n\n${formatMonth(records[0]!.targetMonth)}分の支払いを完了にしました。\n\n合計：${formatAmount(total)}\n完了日時：${formatJst(now)}`;
}

export function itemList(items: PaymentItem[], verb: "修正" | "削除"): string {
  return `${verb}する支払い項目の番号を送信してください。\n\n${items.map((item, index) => `${index + 1}. ${item.name} ${formatAmount(item.amount)}`).join("\n")}`;
}
