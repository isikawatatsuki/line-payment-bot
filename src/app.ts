import { Hono } from "hono";
import { verifyLineSignature } from "./line/signature.js";
import { stripBotMention, type Mention } from "./domain/parser.js";
import { PaymentBot } from "./application/payment-bot.js";
import type { LineClient, Logger, Store } from "./application/ports.js";

interface LineEvent {
  webhookEventId?: string;
  type: string;
  replyToken?: string;
  timestamp?: number;
  source?: { type?: string; groupId?: string; userId?: string };
  message?: {
    type?: string; text?: string;
    mention?: { mentionees?: Array<{ type: string; userId?: string; index?: number; length?: number }> };
  };
  joined?: { members?: Array<{ type: string; userId?: string }> };
  left?: { members?: Array<{ type: string; userId?: string }> };
}

export function createApp(deps: {
  store: Store; line: LineClient; logger: Logger; channelSecret: string; botUserId: string; ttlMinutes?: number;
}) {
  const app = new Hono();
  const bot = new PaymentBot(deps.store, deps.logger, deps.ttlMinutes);
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/webhook", (c) => c.json({ ok: true, message: "LINE webhook endpoint is ready. Use POST for webhook events." }));
  app.post("/webhook", async (c) => {
    const body = await c.req.text();
    if (!verifyLineSignature(body, c.req.header("x-line-signature"), deps.channelSecret)) return c.text("Invalid signature", 401);
    const payload = JSON.parse(body) as { events?: LineEvent[] };
    for (const event of payload.events ?? []) {
      const groupLineId = event.source?.groupId;
      if (!groupLineId) continue;
      if (event.type === "leave") { await deps.store.deactivateGroup(groupLineId); continue; }
      const groupId = await deps.store.ensureGroup(groupLineId);
      if (event.type === "memberLeft") {
        for (const value of event.left?.members ?? []) if (value.userId) await deps.store.deactivateMember(groupId, value.userId, new Date(event.timestamp ?? Date.now()));
        continue;
      }
      if (event.type === "memberJoined" || event.type === "join") {
        for (const value of event.joined?.members ?? []) if (value.userId) {
          const name = await deps.line.getGroupMemberName(groupLineId, value.userId).catch(() => null);
          await deps.store.ensureMember(groupId, value.userId, name ?? "LINEユーザー");
        }
        continue;
      }
      if (event.type !== "message" || event.message?.type !== "text" || !event.source?.userId || !event.replyToken) continue;
      if (event.source.userId === deps.botUserId) continue;
      const rawMentions = event.message.mention?.mentionees ?? [];
      const mentions: Mention[] = [];
      for (const value of rawMentions) {
        if (!value.userId) continue;
        const displayName = await deps.line.getGroupMemberName(groupLineId, value.userId).catch(() => null);
        const resolvedName = displayName ?? "LINEユーザー";
        mentions.push({ lineUserId: value.userId, displayName: resolvedName, ...(value.index === undefined ? {} : { start: value.index }), ...(value.length === undefined ? {} : { length: value.length }) });
        if (value.userId !== deps.botUserId) await deps.store.ensureMember(groupId, value.userId, resolvedName);
      }
      const displayName = await deps.line.getGroupMemberName(groupLineId, event.source.userId).catch(() => null) ?? "LINEユーザー";
      const botMentioned = rawMentions.some((value) => value.userId === deps.botUserId);
      const text = botMentioned ? stripBotMention(event.message.text ?? "", deps.botUserId, mentions) : event.message.text ?? "";
      if (botMentioned && /^(?:6|ダッシュボード|グラフ|Webアプリ)$/i.test(text.trim())) {
        await deps.store.ensureMember(groupId, event.source.userId, displayName);
        const dashboardUrl = new URL("/dashboard/login", c.req.url);
        dashboardUrl.searchParams.set("group", groupId);
        await deps.line.reply(event.replyToken, [`📊 あなたの支払いダッシュボード\n\n${dashboardUrl.toString()}\n\nLINEでログインすると、自分が支払い者になっている項目だけ確認できます。`]);
        continue;
      }
      const responses = await bot.handleText({
        eventId: event.webhookEventId ?? `${event.timestamp}:${event.source.userId}`,
        groupLineId, userLineId: event.source.userId, userDisplayName: displayName,
        text, mentions, botMentioned, now: new Date(event.timestamp ?? Date.now())
      });
      if (responses.length) await deps.line.reply(event.replyToken, responses);
    }
    return c.json({ ok: true });
  });
  return app;
}
