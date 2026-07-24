import { describe, expect, it, vi } from "vitest";
import { PaymentScheduler } from "../src/application/scheduler.js";
import { MemoryStore } from "./helpers/memory-store.js";
import type { LineClient, Logger } from "../src/application/ports.js";

const logger: Logger = { info() {}, error() {} };
it("creates snapshots and does not notify twice", async () => {
  const store = new MemoryStore();
  const group = await store.ensureGroup("G1");
  const payer = await store.ensureMember(group, "U1", "石川");
  await store.createItem({ groupId: group, name: "家賃", startMonth: "2026-07-01", endMonth: null, paymentType: "monthly", paymentDay: 27, specificPaymentDate: null, payerMemberId: payer.id, amount: 120000, note: null, createdByMemberId: payer.id });
  const push = vi.fn(async () => {});
  const line: LineClient = { push, reply: vi.fn(async () => {}), getGroupMemberName: vi.fn(async () => null) };
  const scheduler = new PaymentScheduler(store, line, logger);
  expect(await scheduler.run(new Date("2026-07-26T15:05:00Z"))).toEqual({ notifications: 1 });
  expect(await scheduler.run(new Date("2026-07-26T15:10:00Z"))).toEqual({ notifications: 0 });
  expect(push).toHaveBeenCalledTimes(1);
  expect(store.records[0]).toMatchObject({ amountSnapshot: 120000, notifiedAt: expect.any(Date) });
});
