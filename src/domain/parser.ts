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
