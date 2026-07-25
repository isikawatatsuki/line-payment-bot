import type { LineClient, Logger, Store } from "./ports.js";

// Backfills line_groups.display_name for groups that existed before the webhook started
// recording it (or whose name changed). New/renamed groups are picked up automatically going
// forward via the webhook's join/memberJoined/memberLeft handling; this is for one-off catch-up.
export class GroupNameSyncer {
  constructor(private store: Store, private line: LineClient, private logger: Logger) {}

  async run(): Promise<{ updated: number; failed: number }> {
    const groups = await this.store.listActiveGroups();
    let updated = 0;
    let failed = 0;
    for (const group of groups) {
      try {
        const name = await this.line.getGroupName(group.lineGroupId);
        if (name) { await this.store.ensureGroup(group.lineGroupId, name); updated++; }
      } catch (error) {
        failed++;
        this.logger.error({ groupId: group.groupId, errorType: error instanceof Error ? error.name : "Unknown" }, "group_name_sync_failed");
      }
    }
    return { updated, failed };
  }
}
