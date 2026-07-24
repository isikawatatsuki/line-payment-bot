import type { PaymentRecord } from "../domain/types.js";
import type { LineClient, Logger, Store } from "./ports.js";
import { dueDateNotification, overdueNotification, paymentRequestNotification } from "./messages.js";
import { addDays, daysBetween, todayInTimeZone } from "../domain/date.js";

type NotificationKind = "request" | "due" | "overdue";

export class PaymentScheduler {
  constructor(private store: Store, private line: LineClient, private logger: Logger) {}

  async run(now = new Date()): Promise<{ notifications: number }> {
    const today = todayInTimeZone(now);
    const requestDate = addDays(today, 3);
    const requestRecords = (await this.store.createDueRecords(requestDate))
      .filter((record) => record.status === "pending" && !record.requestNotifiedAt);
    const dueRecords = (await this.store.createDueRecords(today))
      .filter((record) => record.status === "pending" && !record.notifiedAt);
    const overdueRecords = (await this.store.listPendingRecordsDueBefore(today)).filter((record) => {
      const daysLate = daysBetween(record.dueDate, today);
      const alreadySentToday = record.overdueNotifiedAt && todayInTimeZone(record.overdueNotifiedAt) === today;
      return daysLate >= 1 && (daysLate - 1) % 3 === 0 && !alreadySentToday;
    });

    let notifications = 0;
    notifications += await this.send(requestRecords, "request", today, now);
    notifications += await this.send(dueRecords, "due", today, now);
    notifications += await this.send(overdueRecords, "overdue", today, now);
    return { notifications };
  }

  private async send(records: PaymentRecord[], kind: NotificationKind, today: string, now: Date): Promise<number> {
    const groups = new Map<string, PaymentRecord[]>();
    for (const record of records) {
      const key = `${record.groupId}:${record.payerMemberId}:${record.dueDate}`;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }

    let notifications = 0;
    for (const values of groups.values()) {
      const member = await this.store.findMemberById(values[0]!.payerMemberId);
      const lineGroupId = await this.store.findLineGroupId(values[0]!.groupId);
      if (!member || !lineGroupId) continue;
      const message = kind === "request"
        ? paymentRequestNotification(values, member.displayName)
        : kind === "due"
          ? dueDateNotification(values, member.displayName)
          : overdueNotification(values, member.displayName, daysBetween(values[0]!.dueDate, today));
      try {
        await this.line.push(lineGroupId, [message]);
        await this.store.markNotification(values.map((record) => record.id), kind, now);
        notifications++;
      } catch (error) {
        this.logger.error({ groupId: values[0]!.groupId, userId: member.lineUserId, operation: `${kind}_notification`, errorType: error instanceof Error ? error.name : "Unknown" }, "Scheduled notification failed");
      }
    }
    return notifications;
  }
}
