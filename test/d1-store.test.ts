import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { D1Store } from "../src/database/d1-store.js";

function fakeD1(): { db: D1Database; sqlCalls: string[] } {
  const sqlCalls: string[] = [];
  const db = {
    prepare(sql: string) {
      sqlCalls.push(sql);
      return {
        bind: () => ({
          run: async () => ({ meta: { changes: 1, last_row_id: 1 } }),
          all: async () => ({ results: [] }),
          first: async () => null
        })
      };
    }
  } as unknown as D1Database;
  return { db, sqlCalls };
}

describe("D1Store.updateItem", () => {
  it("maps every patched field to its snake_case column name (regression: paymentMethod was left unmapped and broke the edit form with a 500)", async () => {
    const { db, sqlCalls } = fakeD1();
    const store = new D1Store(db);
    await store.updateItem("1", { paymentMethod: "PayPay", totalAmount: 5000, payerMemberId: "M1", startMonth: "2026-08-01" });
    const sql = sqlCalls.find((value) => value.startsWith("UPDATE payment_items"));
    expect(sql).toContain("payment_method = ?");
    expect(sql).toContain("total_amount = ?");
    expect(sql).toContain("payer_member_id = ?");
    expect(sql).toContain("start_month = ?");
    expect(sql).not.toContain("paymentMethod");
    expect(sql).not.toContain("totalAmount");
    expect(sql).not.toContain("payerMemberId");
    expect(sql).not.toContain("startMonth");
  });
});
