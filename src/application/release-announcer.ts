import type { LineClient, Logger, Store } from "./ports.js";

// Sends an arbitrary one-time-per-group release announcement, keyed by announcementKey and
// tracked in the group_announcements table. Triggered explicitly at release time (see
// release-announcements.ts), never on a schedule or on merge.
export class ReleaseAnnouncer {
  constructor(private store: Store, private line: LineClient, private logger: Logger) {}

  async run(announcementKey: string, message: string, now = new Date()): Promise<{ sent: number; failed: number }> {
    const groups = await this.store.listGroupsNeedingAnnouncement(announcementKey);
    let sent = 0;
    let failed = 0;
    for (const group of groups) {
      try {
        await this.line.push(group.lineGroupId, [message]);
        await this.store.markAnnounced(group.groupId, announcementKey, now);
        sent++;
      } catch (error) {
        failed++;
        this.logger.error({ groupId: group.groupId, announcementKey, errorType: error instanceof Error ? error.name : "Unknown" }, "release_announcement_failed");
      }
    }
    return { sent, failed };
  }
}
