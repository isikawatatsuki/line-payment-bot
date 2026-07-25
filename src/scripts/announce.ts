import "dotenv/config";

const key = process.argv[2];
if (!key) throw new Error("Usage: npm run cf:announce -- <key>");

const workerUrl = process.env.WORKER_URL ?? "https://line-payment-bot.tatumagichannel.workers.dev";
const token = process.env.INTERNAL_ADMIN_TOKEN;
if (!token) throw new Error("INTERNAL_ADMIN_TOKEN is required");

const response = await fetch(`${workerUrl}/internal/announce/${encodeURIComponent(key)}`, {
  method: "POST",
  headers: { "x-internal-token": token }
});
if (!response.ok) throw new Error(`Announce request failed: ${response.status} ${await response.text()}`);
console.info(await response.json());
