import type { ScheduledEvent } from "aws-lambda";
import { handle } from "hono/aws-lambda";
import { app, line, logger, store } from "./runtime.js";
import { PaymentScheduler } from "./application/scheduler.js";
import { ReleaseAnnouncer } from "./application/release-announcer.js";
import { RELEASE_ANNOUNCEMENTS } from "./application/release-announcements.js";
import { GroupNameSyncer } from "./application/group-name-syncer.js";

export const webhook = handle(app);
export async function scheduled(_event: ScheduledEvent) {
  return new PaymentScheduler(store, line, logger, process.env.WORKER_URL).run();
}
// `serverless invoke -f announceRelease --data '{"key":"total-amount"}'`, invoked manually right
// after a release (not on the daily schedule and not on merge), so announcements go out exactly
// when a feature goes live. See release-announcements.ts to register new keys.
export async function announceRelease(event: { key: string }) {
  const buildMessage = RELEASE_ANNOUNCEMENTS[event.key];
  if (!buildMessage) throw new Error(`Unknown announcement key: ${event.key}`);
  return new ReleaseAnnouncer(store, line, logger).run(event.key, buildMessage());
}
// `serverless invoke -f syncGroupNames`, one-off catch-up for groups created before display_name
// was recorded.
export async function syncGroupNames() {
  return new GroupNameSyncer(store, line, logger).run();
}
