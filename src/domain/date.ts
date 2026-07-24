const MONTH_RE = /(\d{4})\s*年?[\/\-]?\s*(\d{1,2})\s*月?/;

export function parseMonth(input: string): string | null {
  const match = input.trim().match(MONTH_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 9999 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function endOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthlyDueDate(targetMonth: string, paymentDay: number): string {
  if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) {
    throw new Error("paymentDay must be an integer from 1 to 31");
  }
  const [year, month] = targetMonth.split("-").map(Number);
  if (!year || !month) throw new Error("invalid targetMonth");
  const day = Math.min(paymentDay, endOfMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function targetMonthOf(date: Date, timeZone = "Asia/Tokyo"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit"
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}-01`;
}

export function todayInTimeZone(date: Date, timeZone = "Asia/Tokyo"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

export function formatMonth(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return `${year}年${value}月`;
}

export function formatJst(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}
