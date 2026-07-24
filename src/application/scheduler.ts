import type { LineClient, Logger, Store } from "./ports.js";
import { notification } from "./messages.js";
import { todayInTimeZone } from "../domain/date.js";

export class PaymentScheduler {
  constructor(private store: Store, private line: LineClient, private logger: Logger) {}

  async run(now = new Date()): Promise<{ notifications: number }> {
    const records = await this.store.createDueRecords(todayInTimeZone(now));
    const pending = records.filter((record) => !record.notifiedAt && record.status === "pending");
    const groups = new Map<string, typeof pending>();
    for (const value of pending) {
      const key = `${value.groupId}:${value.payerMemberId}`;
      groups.set(key, [...(groups.get(key) ?? []), value]);
    }
    let notifications = 0;
    for (const values of groups.values()) {
      const member = await this.store.findMemberById(values[0]!.payerMemberId);
      if (!member) continue;
      const lineGroupId = await this.store.findLineGroupId(values[0]!.groupId);
      if (!lineGroupId) continue;
      try {
        await this.line.push(lineGroupId, [notification(values, member.displayName)]);
        await this.store.markNotified(values.map((record) => record.id), now);
        notifications++;
      } catch (error) {
        this.logger.error({ groupId: values[0]!.groupId, userId: member.lineUserId, operation: "scheduled_notification", errorType: error instanceof Error ? error.name : "Unknown" }, "Scheduled notification failed");
      }
    }
    return { notifications };
  }
}
