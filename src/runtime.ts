import "dotenv/config";
import { createApp } from "./app.js";
import { getDatabase } from "./database/connection.js";
import { KyselyStore } from "./database/kysely-store.js";
import { LineMessagingClient } from "./line/client.js";
import { consoleLogger } from "./application/ports.js";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const secret = process.env.LINE_CHANNEL_SECRET;
if (!token || !secret) throw new Error("LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET are required");

export const store = new KyselyStore(getDatabase());
export const line = new LineMessagingClient(token);
export const logger = consoleLogger;
export const app = createApp({ store, line, logger, channelSecret: secret, ...(process.env.INTERNAL_ADMIN_TOKEN ? { internalAdminToken: process.env.INTERNAL_ADMIN_TOKEN } : {}) });
