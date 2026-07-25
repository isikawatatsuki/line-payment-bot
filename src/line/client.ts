import type { LineClient } from "../application/ports.js";

export class LineMessagingClient implements LineClient {
  constructor(private token: string) {}
  private async request(path: string, body: unknown) {
    const response = await fetch(`https://api.line.me${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`LINE API returned ${response.status}`);
  }
  push(groupLineId: string, messages: string[]) { return this.request("/v2/bot/message/push", { to: groupLineId, messages: messages.map((text) => ({ type: "text", text })) }); }
  async getGroupMemberName(groupId: string, userId: string) {
    const response = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) return null;
    return String((await response.json() as { displayName?: string }).displayName ?? "") || null;
  }
  async getGroupName(groupId: string) {
    const response = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) return null;
    return String((await response.json() as { groupName?: string }).groupName ?? "") || null;
  }
}
