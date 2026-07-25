import { describe, expect, it, vi } from "vitest";
import { PaymentScheduler } from "../src/application/scheduler.js";
import { MemoryStore } from "./helpers/memory-store.js";
import type { LineClient, Logger } from "../src/application/ports.js";

const logger: Logger = { info() {}, error() {} };
it("sends request, due-date, and recurring overdue notifications without duplicates", async () => {
  const store = new MemoryStore();
  const group = await store.ensureGroup("G1");
  const payer = await store.ensureMember(group, "U1", "石川");
  await store.createItem({ groupId: group, name: "家賃", startMonth: "2026-07-01", endMonth: null, paymentType: "monthly", paymentDay: 27, specificPaymentDate: null, payerMemberId: payer.id, amount: 120000, totalAmount: null, paymentMethod: "銀行振込", note: null, createdByMemberId: payer.id });
  const sent: string[] = [];
  const push = vi.fn(async (_groupId: string, messages: string[]) => { sent.push(...messages); });
  const line: LineClient = { push, getGroupMemberName: vi.fn(async () => null), getGroupName: vi.fn(async () => null) };
  const scheduler = new PaymentScheduler(store, line, logger, "https://example.workers.dev");
  expect(await scheduler.run(new Date("2026-07-23T21:00:00Z"))).toEqual({ notifications: 1 });
  expect(await scheduler.run(new Date("2026-07-23T21:01:00Z"))).toEqual({ notifications: 0 });
  expect(sent[0]).toContain("支払い依頼");
  expect(sent[0]).toContain("https://example.workers.dev/dashboard/login");
  expect(store.records[0]).toMatchObject({ amountSnapshot: 120000, paymentMethodSnapshot: "銀行振込", requestNotifiedAt: expect.any(Date) });

  expect(await scheduler.run(new Date("2026-07-26T21:00:00Z"))).toEqual({ notifications: 1 });
  expect(await scheduler.run(new Date("2026-07-26T21:01:00Z"))).toEqual({ notifications: 0 });
  expect(sent[1]).toContain("本日が支払期限");
  expect(store.records[0]?.notifiedAt).toBeInstanceOf(Date);

  expect(await scheduler.run(new Date("2026-07-27T21:00:00Z"))).toEqual({ notifications: 1 });
  expect(await scheduler.run(new Date("2026-07-27T21:01:00Z"))).toEqual({ notifications: 0 });
  expect(await scheduler.run(new Date("2026-07-28T21:00:00Z"))).toEqual({ notifications: 0 });
  expect(await scheduler.run(new Date("2026-07-30T21:00:00Z"))).toEqual({ notifications: 1 });
  expect(sent[2]).toContain("期限を1日超過");
  expect(sent[3]).toContain("期限を4日超過");
  expect(push).toHaveBeenCalledTimes(4);
});
