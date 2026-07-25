import type { NewPaymentItem, Store } from "../../src/application/ports.js";
import type { Member, PaymentItem, PaymentRecord } from "../../src/domain/types.js";
import { monthlyDueDate } from "../../src/domain/date.js";

export class MemoryStore implements Store {
  events = new Set<string>();
  groups = new Map<string, string>();
  inactiveGroupIds = new Set<string>();
  announcedKeys = new Set<string>();
  members: Member[] = [];
  items: PaymentItem[] = [];
  records: PaymentRecord[] = [];
  private sequence = 0;
  private id() { return String(++this.sequence); }
  async claimEvent(id: string) { if (this.events.has(id)) return false; this.events.add(id); return true; }
  async ensureGroup(lineId: string) { if (!this.groups.has(lineId)) this.groups.set(lineId, this.id()); return this.groups.get(lineId)!; }
  async findLineGroupId(groupId: string) { return [...this.groups].find(([, id]) => id === groupId)?.[0] ?? null; }
  async deactivateGroup(lineGroupId: string) { const id = this.groups.get(lineGroupId); if (id) this.inactiveGroupIds.add(id); }
  async listGroupsNeedingAnnouncement(announcementKey: string) {
    return [...this.groups]
      .filter(([, groupId]) => !this.inactiveGroupIds.has(groupId) && !this.announcedKeys.has(`${groupId}:${announcementKey}`))
      .map(([lineGroupId, groupId]) => ({ groupId, lineGroupId }));
  }
  async markAnnounced(groupId: string, announcementKey: string) { this.announcedKeys.add(`${groupId}:${announcementKey}`); }
  async listActiveGroups() { return [...this.groups].filter(([, groupId]) => !this.inactiveGroupIds.has(groupId)).map(([lineGroupId, groupId]) => ({ groupId, lineGroupId })); }
  async ensureMember(groupId: string, lineUserId: string, displayName: string) {
    let value = this.members.find((m) => m.groupId === groupId && m.lineUserId === lineUserId);
    if (!value) { value = { id: this.id(), groupId, lineUserId, displayName, isActive: true }; this.members.push(value); }
    value.displayName = displayName; value.isActive = true; return value;
  }
  async findMember(groupId: string, lineUserId: string) { return this.members.find((m) => m.groupId === groupId && m.lineUserId === lineUserId) ?? null; }
  async findMemberById(id: string) { return this.members.find((m) => m.id === id) ?? null; }
  async deactivateMember(groupId: string, lineUserId: string) { const m = await this.findMember(groupId, lineUserId); if (m) m.isActive = false; }
  async listActiveItems(groupId: string) { return this.items.filter((i) => i.groupId === groupId && i.isActive); }
  async findItem(id: string) { return this.items.find((i) => i.id === id) ?? null; }
  async createItem(value: NewPaymentItem) { const created = { ...value, id: this.id(), isActive: true }; this.items.push(created); return created; }
  async updateItem(id: string, patch: Partial<NewPaymentItem>) { Object.assign(this.items.find((i) => i.id === id)!, patch); }
  async deactivateItem(id: string) { this.items.find((i) => i.id === id)!.isActive = false; }
  async sumPaidAmount(paymentItemId: string) { return this.records.filter((r) => r.paymentItemId === paymentItemId && r.status === "paid").reduce((sum, r) => sum + r.amountSnapshot, 0); }
  async createDueRecords(date: string) {
    const target = `${date.slice(0, 7)}-01`;
    for (const value of this.items.filter((i) => i.isActive)) {
      const due = value.paymentType === "monthly" ? monthlyDueDate(target, value.paymentDay!) : value.specificPaymentDate;
      if (due !== date || this.records.some((r) => r.paymentItemId === value.id && r.targetMonth === target)) continue;
      this.records.push({ id: this.id(), paymentItemId: value.id, groupId: value.groupId, payerMemberId: value.payerMemberId, targetMonth: target, itemNameSnapshot: value.name, amountSnapshot: value.amount, paymentMethodSnapshot: value.paymentMethod, dueDate: due, status: "pending", requestNotifiedAt: null, notifiedAt: null, overdueNotifiedAt: null, paidAt: null, completedByMemberId: null });
    }
    return this.records.filter((r) => r.dueDate === date);
  }
  async listRecords(g: string, month: string, payer?: string) { return this.records.filter((r) => r.groupId === g && r.targetMonth === month && (!payer || r.payerMemberId === payer)); }
  async listPendingRecordsDueBefore(date: string) { return this.records.filter((r) => r.status === "pending" && r.dueDate < date); }
  async markPaid(ids: string[], member: string, now: Date) { let n = 0; for (const r of this.records) if (ids.includes(r.id) && r.payerMemberId === member && r.status === "pending") { r.status = "paid"; r.paidAt = now; r.completedByMemberId = member; n++; } return n; }
  async markNotification(ids: string[], kind: "request" | "due" | "overdue", now: Date) { let n = 0; for (const r of this.records) if (ids.includes(r.id)) { if (kind === "request") r.requestNotifiedAt = now; else if (kind === "due") r.notifiedAt = now; else r.overdueNotifiedAt = now; n++; } return n; }
}
