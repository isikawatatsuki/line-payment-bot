import "dotenv/config";

const workerUrl = process.env.WORKER_URL ?? "https://line-payment-bot.tatumagichannel.workers.dev";
const token = process.env.INTERNAL_ADMIN_TOKEN;
if (!token) throw new Error("INTERNAL_ADMIN_TOKEN is required");

const response = await fetch(`${workerUrl}/internal/sync-group-names`, {
  method: "POST",
  headers: { "x-internal-token": token }
});
if (!response.ok) throw new Error(`Sync request failed: ${response.status} ${await response.text()}`);
console.info(await response.json());
