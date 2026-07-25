import type { PaymentRecord } from "../domain/types.js";
import { formatAmount } from "../domain/parser.js";
import { formatMonth } from "../domain/date.js";

function notificationDetails(records: PaymentRecord[]): string {
  const total = records.reduce((sum, record) => sum + record.amountSnapshot, 0);
  const lines = records.map((record) => `${record.itemNameSnapshot}　${formatAmount(record.amountSnapshot)}${record.paymentMethodSnapshot ? `\n　希望支払い方法: ${record.paymentMethodSnapshot}` : ""}`);
  return `合計：${formatAmount(total)}\n\n【内訳】\n${lines.join("\n")}\n\n支払期限：${records[0]?.dueDate}`;
}

const dashboardLine = (dashboardUrl?: string) => dashboardUrl ? `\n\n支払い状況の確認・支払い完了はこちらから:\n${dashboardUrl}` : "";

export function paymentRequestNotification(records: PaymentRecord[], memberName: string, dashboardUrl?: string): string {
  const month = records[0]?.targetMonth ?? "";
  return `@${memberName}\n\n📨 ${formatMonth(month)} 支払い依頼\n\n${notificationDetails(records)}\n\n期限の3日前です。支払いをお願いします。${dashboardLine(dashboardUrl)}`;
}

export function dueDateNotification(records: PaymentRecord[], memberName: string, dashboardUrl?: string): string {
  const month = records[0]?.targetMonth ?? "";
  return `@${memberName}\n\n⏰ ${formatMonth(month)} 本日が支払期限です\n\n${notificationDetails(records)}${dashboardLine(dashboardUrl)}`;
}

export function overdueNotification(records: PaymentRecord[], memberName: string, daysLate: number, dashboardUrl?: string): string {
  return `@${memberName}\n\n⚠️ 支払い期限を${daysLate}日超過しています\n\n${notificationDetails(records)}${dashboardLine(dashboardUrl)}`;
}
