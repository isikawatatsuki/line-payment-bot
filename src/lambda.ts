import type { ScheduledEvent } from "aws-lambda";
import { handle } from "hono/aws-lambda";
import { app, line, logger, store } from "./runtime.js";
import { PaymentScheduler } from "./application/scheduler.js";

export const webhook = handle(app);
export async function scheduled(_event: ScheduledEvent) {
  return new PaymentScheduler(store, line, logger).run();
}
