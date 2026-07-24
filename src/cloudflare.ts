import type { D1Database, ExecutionContext, ScheduledController } from "@cloudflare/workers-types";
import { createApp } from "./app.js";
import { D1Store } from "./database/d1-store.js";
import { LineMessagingClient } from "./line/client.js";
import { consoleLogger } from "./application/ports.js";
import { PaymentScheduler } from "./application/scheduler.js";
import { registerDashboardRoutes } from "./dashboard.js";

interface Env {
  DB: D1Database;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_BOT_USER_ID: string;
  APP_TIMEZONE: string;
  CONVERSATION_TTL_MINUTES: string;
  DASHBOARD_PASSWORD: string;
  DASHBOARD_SESSION_SECRET: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
}

function dependencies(env: Env) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_CHANNEL_SECRET || !env.LINE_BOT_USER_ID) {
    throw new Error("LINE secrets are not configured");
  }
  return {
    store: new D1Store(env.DB),
    line: new LineMessagingClient(env.LINE_CHANNEL_ACCESS_TOKEN),
    logger: consoleLogger,
    channelSecret: env.LINE_CHANNEL_SECRET,
    botUserId: env.LINE_BOT_USER_ID,
    ttlMinutes: Number(env.CONVERSATION_TTL_MINUTES || 30)
  };
}

export default {
  fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const deps = dependencies(env);
    const app = createApp(deps);
    registerDashboardRoutes(app, env.DB, env.DASHBOARD_PASSWORD, env.DASHBOARD_SESSION_SECRET, env.LINE_LOGIN_CHANNEL_ID, env.LINE_LOGIN_CHANNEL_SECRET);
    return app.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const deps = dependencies(env);
    ctx.waitUntil(new PaymentScheduler(deps.store, deps.line, deps.logger).run());
  }
};
