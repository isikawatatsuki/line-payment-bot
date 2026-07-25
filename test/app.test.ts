import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.js";
import { MemoryStore } from "./helpers/memory-store.js";
import type { LineClient, Logger } from "../src/application/ports.js";

const logger: Logger = { info() {}, error() {} };
const secret = "channel-secret";

function buildLine(overrides: Partial<LineClient> = {}): LineClient {
  return { push: vi.fn(async () => {}), getGroupMemberName: vi.fn(async () => null), getGroupName: vi.fn(async () => null), ...overrides };
}

function sign(body: string) {
  return createHmac("sha256", secret).update(body).digest("base64");
}

async function postWebhook(app: ReturnType<typeof createApp>, events: unknown[]) {
  const body = JSON.stringify({ events });
  return app.request("/webhook", { method: "POST", headers: { "x-line-signature": sign(body) }, body });
}

describe("POST /webhook", () => {
  it("rejects an invalid signature", async () => {
    const app = createApp({ store: new MemoryStore(), line: buildLine(), logger, channelSecret: secret });
    const response = await app.request("/webhook", { method: "POST", headers: { "x-line-signature": "wrong" }, body: JSON.stringify({ events: [] }) });
    expect(response.status).toBe(401);
  });

  it("registers group members on join without sending any chat reply", async () => {
    const store = new MemoryStore();
    const line = buildLine({ getGroupMemberName: vi.fn(async () => "石川") });
    const app = createApp({ store, line, logger, channelSecret: secret });

    const response = await postWebhook(app, [{ type: "join", source: { type: "group", groupId: "G1" }, joined: { members: [{ type: "user", userId: "U1" }] } }]);

    expect(response.status).toBe(200);
    expect(store.members).toEqual([expect.objectContaining({ lineUserId: "U1", displayName: "石川" })]);
    expect(line.push).not.toHaveBeenCalled();
  });

  it("fetches and stores the LINE group name so groups aren't shown as unnamed", async () => {
    const store = new MemoryStore();
    const ensureGroupSpy = vi.spyOn(store, "ensureGroup");
    const line = buildLine({ getGroupMemberName: vi.fn(async () => "石川"), getGroupName: vi.fn(async () => "シェアハウスA") });
    const app = createApp({ store, line, logger, channelSecret: secret });

    await postWebhook(app, [{ type: "join", source: { type: "group", groupId: "G1" }, joined: { members: [{ type: "user", userId: "U1" }] } }]);

    expect(ensureGroupSpy).toHaveBeenCalledWith("G1", "シェアハウスA");
  });

  it("deactivates the group on leave and a member on memberLeft", async () => {
    const store = new MemoryStore();
    const line = buildLine();
    const app = createApp({ store, line, logger, channelSecret: secret });
    await postWebhook(app, [{ type: "join", source: { type: "group", groupId: "G1" }, joined: { members: [{ type: "user", userId: "U1" }] } }]);

    await postWebhook(app, [{ type: "memberLeft", source: { type: "group", groupId: "G1" }, left: { members: [{ type: "user", userId: "U1" }] } }]);
    expect(store.members[0]?.isActive).toBe(false);

    await postWebhook(app, [{ type: "leave", source: { type: "group", groupId: "G1" } }]);
    expect(store.inactiveGroupIds.has(store.groups.get("G1")!)).toBe(true);
  });
});

describe("POST /internal/announce/:key", () => {
  it("rejects requests without a valid admin token", async () => {
    const store = new MemoryStore();
    const line = buildLine();
    const app = createApp({ store, line, logger, channelSecret: secret, internalAdminToken: "correct-token" });

    const response = await app.request("/internal/announce/total-amount", { method: "POST" });
    expect(response.status).toBe(401);
    expect(line.push).not.toHaveBeenCalled();
  });

  it("rejects any token when no admin token is configured", async () => {
    const store = new MemoryStore();
    const line = buildLine();
    const app = createApp({ store, line, logger, channelSecret: secret });

    const response = await app.request("/internal/announce/total-amount", { method: "POST", headers: { "x-internal-token": "anything" } });
    expect(response.status).toBe(401);
  });

  it("returns 404 for an unknown announcement key", async () => {
    const store = new MemoryStore();
    const line = buildLine();
    const app = createApp({ store, line, logger, channelSecret: secret, internalAdminToken: "correct-token" });

    const response = await app.request("/internal/announce/does-not-exist", { method: "POST", headers: { "x-internal-token": "correct-token" } });
    expect(response.status).toBe(404);
  });

  it("runs the total-amount announcement once per group when authorized", async () => {
    const store = new MemoryStore();
    await store.ensureGroup("G1");
    await store.ensureGroup("G2");
    const line = buildLine();
    const app = createApp({ store, line, logger, channelSecret: secret, internalAdminToken: "correct-token" });

    const first = await app.request("/internal/announce/total-amount", { method: "POST", headers: { "x-internal-token": "correct-token" } });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ sent: 2, failed: 0 });
    expect(line.push).toHaveBeenCalledTimes(2);

    const second = await app.request("/internal/announce/total-amount", { method: "POST", headers: { "x-internal-token": "correct-token" } });
    expect(await second.json()).toEqual({ sent: 0, failed: 0 });
    expect(line.push).toHaveBeenCalledTimes(2);
  });
});

describe("POST /internal/sync-group-names", () => {
  it("rejects requests without a valid admin token", async () => {
    const store = new MemoryStore();
    const line = buildLine();
    const app = createApp({ store, line, logger, channelSecret: secret, internalAdminToken: "correct-token" });

    const response = await app.request("/internal/sync-group-names", { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("backfills the display name for every active group", async () => {
    const store = new MemoryStore();
    const ensureGroupSpy = vi.spyOn(store, "ensureGroup");
    await store.ensureGroup("G1");
    await store.ensureGroup("G2");
    const line = buildLine({ getGroupName: vi.fn(async (groupId: string) => (groupId === "G1" ? "シェアハウスA" : "シェアハウスB")) });
    const app = createApp({ store, line, logger, channelSecret: secret, internalAdminToken: "correct-token" });

    const response = await app.request("/internal/sync-group-names", { method: "POST", headers: { "x-internal-token": "correct-token" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 2, failed: 0 });
    expect(ensureGroupSpy).toHaveBeenCalledWith("G1", "シェアハウスA");
    expect(ensureGroupSpy).toHaveBeenCalledWith("G2", "シェアハウスB");
  });
});
