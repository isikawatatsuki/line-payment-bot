import { Hono } from "hono";
import { verifyLineSignature } from "./line/signature.js";
import { ReleaseAnnouncer } from "./application/release-announcer.js";
import { RELEASE_ANNOUNCEMENTS } from "./application/release-announcements.js";
import { GroupNameSyncer } from "./application/group-name-syncer.js";
import type { LineClient, Logger, Store } from "./application/ports.js";

interface LineEvent {
  webhookEventId?: string;
  type: string;
  timestamp?: number;
  source?: { type?: string; groupId?: string; userId?: string };
  joined?: { members?: Array<{ type: string; userId?: string }> };
  left?: { members?: Array<{ type: string; userId?: string }> };
}

export function createApp(deps: {
  store: Store; line: LineClient; logger: Logger; channelSecret: string; internalAdminToken?: string;
}) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/webhook", (c) => c.json({ ok: true, message: "LINE webhook endpoint is ready. Use POST for webhook events." }));
  // Fired explicitly right after a production deploy (not on a schedule, and not on merge) so
  // release announcements go out exactly when the feature actually becomes live for users.
  app.post("/internal/announce/:key", async (c) => {
    if (!deps.internalAdminToken || c.req.header("x-internal-token") !== deps.internalAdminToken) {
      return c.text("Unauthorized", 401);
    }
    const key = c.req.param("key");
    const buildMessage = RELEASE_ANNOUNCEMENTS[key];
    if (!buildMessage) return c.text("Unknown announcement key", 404);
    const result = await new ReleaseAnnouncer(deps.store, deps.line, deps.logger).run(key, buildMessage());
    return c.json(result);
  });
  // One-off catch-up for groups that were created before display_name was recorded.
  app.post("/internal/sync-group-names", async (c) => {
    if (!deps.internalAdminToken || c.req.header("x-internal-token") !== deps.internalAdminToken) {
      return c.text("Unauthorized", 401);
    }
    const result = await new GroupNameSyncer(deps.store, deps.line, deps.logger).run();
    return c.json(result);
  });
  // Registration, editing, and payment completion happen on the web dashboard now; the webhook
  // only keeps group/member membership in sync so scheduled notifications and LINE Login can work.
  app.post("/webhook", async (c) => {
    const body = await c.req.text();
    if (!verifyLineSignature(body, c.req.header("x-line-signature"), deps.channelSecret)) return c.text("Invalid signature", 401);
    const payload = JSON.parse(body) as { events?: LineEvent[] };
    for (const event of payload.events ?? []) {
      const groupLineId = event.source?.groupId;
      if (!groupLineId) continue;
      if (event.type === "leave") { await deps.store.deactivateGroup(groupLineId); continue; }
      const groupName = await deps.line.getGroupName(groupLineId).catch(() => null);
      const groupId = await deps.store.ensureGroup(groupLineId, groupName ?? undefined);
      if (event.type === "memberLeft") {
        for (const value of event.left?.members ?? []) if (value.userId) await deps.store.deactivateMember(groupId, value.userId, new Date(event.timestamp ?? Date.now()));
        continue;
      }
      if (event.type === "memberJoined" || event.type === "join") {
        for (const value of event.joined?.members ?? []) if (value.userId) {
          const name = await deps.line.getGroupMemberName(groupLineId, value.userId).catch(() => null);
          await deps.store.ensureMember(groupId, value.userId, name ?? "LINEユーザー");
        }
      }
    }
    return c.json({ ok: true });
  });
  return app;
}
