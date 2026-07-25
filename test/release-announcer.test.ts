import { describe, expect, it, vi } from "vitest";
import { ReleaseAnnouncer } from "../src/application/release-announcer.js";
import { MemoryStore } from "./helpers/memory-store.js";
import type { LineClient, Logger } from "../src/application/ports.js";

const logger: Logger = { info() {}, error() {} };

function buildLine(): LineClient {
  return { push: vi.fn(async () => {}), getGroupMemberName: vi.fn(async () => null), getGroupName: vi.fn(async () => null) };
}

describe("ReleaseAnnouncer", () => {
  it("sends a given announcement to each active group exactly once, keyed independently per announcement", async () => {
    const store = new MemoryStore();
    await store.ensureGroup("G1");
    await store.ensureGroup("G2");
    const line = buildLine();
    const announcer = new ReleaseAnnouncer(store, line, logger);

    expect(await announcer.run("total-amount", "総額機能のお知らせ")).toEqual({ sent: 2, failed: 0 });
    expect(line.push).toHaveBeenCalledTimes(2);
    expect(line.push).toHaveBeenCalledWith("G1", ["総額機能のお知らせ"]);

    expect(await announcer.run("total-amount", "総額機能のお知らせ")).toEqual({ sent: 0, failed: 0 });
    expect(line.push).toHaveBeenCalledTimes(2);

    expect(await announcer.run("another-feature", "別機能のお知らせ")).toEqual({ sent: 2, failed: 0 });
    expect(line.push).toHaveBeenCalledTimes(4);
  });

  it("does not mark a group as announced when the push fails", async () => {
    const store = new MemoryStore();
    await store.ensureGroup("G1");
    const line = buildLine();
    line.push = vi.fn(async () => { throw new Error("LINE API returned 500"); });
    const announcer = new ReleaseAnnouncer(store, line, logger);

    expect(await announcer.run("total-amount", "総額機能のお知らせ")).toEqual({ sent: 0, failed: 1 });
    expect(await announcer.run("total-amount", "総額機能のお知らせ")).toEqual({ sent: 0, failed: 1 });
  });
});
