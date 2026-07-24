import "dotenv/config";
import { createApp } from "./app.js";
import { getDatabase } from "./database/connection.js";
import { KyselyStore } from "./database/kysely-store.js";
import { LineMessagingClient } from "./line/client.js";
import { consoleLogger } from "./application/ports.js";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const secret = process.env.LINE_CHANNEL_SECRET;
const botUserId = process.env.LINE_BOT_USER_ID;
if (!token || !secret || !botUserId) throw new Error("LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET and LINE_BOT_USER_ID are required");

export const store = new KyselyStore(getDatabase());
export const line = new LineMessagingClient(token);
export const logger = consoleLogger;
export const app = createApp({
  store, line, logger, channelSecret: secret, botUserId,
  ttlMinutes: Number(process.env.CONVERSATION_TTL_MINUTES ?? 30)
});
