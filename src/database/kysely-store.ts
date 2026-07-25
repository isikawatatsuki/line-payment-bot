import type { Kysely } from "kysely";
import type { Store, NewPaymentItem } from "../application/ports.js";
import type { Member, PaymentItem, PaymentRecord } from "../domain/types.js";
import type { Database, LineMemberRow, PaymentItemRow, PaymentRecordRow } from "./schema.js";
import { monthlyDueDate } from "../domain/date.js";

const item = (row: PaymentItemRow): PaymentItem => ({
  id: String(row.id), groupId: String(row.group_id), name: row.name, startMonth: String(row.start_month),
  endMonth: row.end_month ? String(row.end_month) : null, paymentType: row.payment_type,
  paymentDay: row.payment_day, specificPaymentDate: row.specific_payment_date ? String(row.specific_payment_date) : null,
  payerMemberId: String(row.payer_member_id), amount: Number(row.amount), totalAmount: row.total_amount === null ? null : Number(row.total_amount), paymentMethod: row.payment_method, note: row.note,
  isActive: Boolean(row.is_active), createdByMemberId: String(row.created_by_member_id)
});
const member = (row: LineMemberRow): Member => ({
  id: String(row.id), groupId: String(row.group_id), lineUserId: row.line_user_id,
  displayName: row.display_name, isActive: Boolean(row.is_active)
});
const record = (row: PaymentRecordRow): PaymentRecord => ({
  id: String(row.id), paymentItemId: String(row.payment_item_id), groupId: String(row.group_id),
  payerMemberId: String(row.payer_member_id), targetMonth: String(row.target_month),
  itemNameSnapshot: row.item_name_snapshot, amountSnapshot: Number(row.amount_snapshot), paymentMethodSnapshot: row.payment_method_snapshot,
  dueDate: String(row.due_date), status: row.status, requestNotifiedAt: row.request_notified_at ? new Date(row.request_notified_at) : null,
  notifiedAt: row.notified_at ? new Date(row.notified_at) : null, overdueNotifiedAt: row.overdue_notified_at ? new Date(row.overdue_notified_at) : null,
  paidAt: row.paid_at ? new Date(row.paid_at) : null,
  completedByMemberId: row.completed_by_member_id ? String(row.completed_by_member_id) : null
});

export class KyselyStore implements Store {
  constructor(private db: Kysely<Database>) {}

  async claimEvent(eventId: string, now: Date): Promise<boolean> {
    const result = await this.db.insertInto("processed_line_events").values({ line_event_id: eventId, processed_at: now })
      .ignore().executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
  }
  async ensureGroup(lineGroupId: string, displayName?: string): Promise<string> {
    await this.db.insertInto("line_groups").values({ line_group_id: lineGroupId, display_name: displayName ?? null, is_active: true })
      .onDuplicateKeyUpdate({ is_active: true, ...(displayName ? { display_name: displayName } : {}) }).execute();
    const row = await this.db.selectFrom("line_groups").select("id").where("line_group_id", "=", lineGroupId).executeTakeFirstOrThrow();
    return String(row.id);
  }
  async findLineGroupId(groupId: string) {
    const row = await this.db.selectFrom("line_groups").select("line_group_id").where("id", "=", groupId).executeTakeFirst();
    return row?.line_group_id ?? null;
  }
  async deactivateGroup(lineGroupId: string) { await this.db.updateTable("line_groups").set({ is_active: false }).where("line_group_id", "=", lineGroupId).execute(); }
  async listGroupsNeedingAnnouncement(announcementKey: string) {
    const rows = await this.db.selectFrom("line_groups")
      .leftJoin("group_announcements", (join) => join
        .onRef("group_announcements.group_id", "=", "line_groups.id")
        .on("group_announcements.announcement_key", "=", announcementKey))
      .select(["line_groups.id as id", "line_groups.line_group_id as line_group_id"])
      .where("line_groups.is_active", "=", true)
      .where("group_announcements.group_id", "is", null)
      .execute();
    return rows.map((row) => ({ groupId: String(row.id), lineGroupId: row.line_group_id }));
  }
  async listActiveGroups() {
    const rows = await this.db.selectFrom("line_groups").select(["id", "line_group_id"]).where("is_active", "=", true).execute();
    return rows.map((row) => ({ groupId: String(row.id), lineGroupId: row.line_group_id }));
  }
  async markAnnounced(groupId: string, announcementKey: string, now: Date) {
    await this.db.insertInto("group_announcements").values({ group_id: groupId, announcement_key: announcementKey, announced_at: now })
      .onDuplicateKeyUpdate({ announced_at: now }).execute();
  }
  async ensureMember(groupId: string, lineUserId: string, displayName: string): Promise<Member> {
    await this.db.insertInto("line_members").values({ group_id: groupId, line_user_id: lineUserId, display_name: displayName, is_active: true, joined_at: new Date(), left_at: null })
      .onDuplicateKeyUpdate({ display_name: displayName, is_active: true, left_at: null }).execute();
    return member(await this.db.selectFrom("line_members").selectAll().where("group_id", "=", groupId).where("line_user_id", "=", lineUserId).executeTakeFirstOrThrow());
  }
  async findMember(groupId: string, lineUserId: string) {
    const row = await this.db.selectFrom("line_members").selectAll().where("group_id", "=", groupId).where("line_user_id", "=", lineUserId).executeTakeFirst();
    return row ? member(row) : null;
  }
  async findMemberById(memberId: string) {
    const row = await this.db.selectFrom("line_members").selectAll().where("id", "=", memberId).executeTakeFirst();
    return row ? member(row) : null;
  }
  async deactivateMember(groupId: string, lineUserId: string, now: Date) {
    await this.db.updateTable("line_members").set({ is_active: false, left_at: now }).where("group_id", "=", groupId).where("line_user_id", "=", lineUserId).execute();
  }
  async listActiveItems(groupId: string) { return (await this.db.selectFrom("payment_items").selectAll().where("group_id", "=", groupId).where("is_active", "=", true).orderBy("id").execute()).map(item); }
  async findItem(id: string) { const row = await this.db.selectFrom("payment_items").selectAll().where("id", "=", id).executeTakeFirst(); return row ? item(row) : null; }
  async createItem(value: NewPaymentItem) {
    const result = await this.db.insertInto("payment_items").values({
      group_id: value.groupId, name: value.name, start_month: value.startMonth, end_month: value.endMonth,
      payment_type: value.paymentType, payment_day: value.paymentDay, specific_payment_date: value.specificPaymentDate,
      payer_member_id: value.payerMemberId, amount: value.amount, total_amount: value.totalAmount, payment_method: value.paymentMethod, note: value.note, is_active: true,
      created_by_member_id: value.createdByMemberId
    }).executeTakeFirstOrThrow();
    return (await this.findItem(String(result.insertId)))!;
  }
  async updateItem(id: string, patch: Partial<NewPaymentItem>) {
    const values: Record<string, unknown> = {};
    const mapping: Record<string, string> = { groupId: "group_id", startMonth: "start_month", endMonth: "end_month", paymentType: "payment_type", paymentDay: "payment_day", specificPaymentDate: "specific_payment_date", payerMemberId: "payer_member_id", totalAmount: "total_amount", paymentMethod: "payment_method", createdByMemberId: "created_by_member_id" };
    for (const [key, value] of Object.entries(patch)) values[mapping[key] ?? key] = value;
    await this.db.updateTable("payment_items").set(values).where("id", "=", id).execute();
  }
  async deactivateItem(id: string) { await this.db.updateTable("payment_items").set({ is_active: false }).where("id", "=", id).execute(); }
  async sumPaidAmount(paymentItemId: string) {
    const row = await this.db.selectFrom("payment_records").select((eb) => eb.fn.sum<number>("amount_snapshot").as("total"))
      .where("payment_item_id", "=", paymentItemId).where("status", "=", "paid").executeTakeFirst();
    return Number(row?.total ?? 0);
  }
  async createDueRecords(date: string): Promise<PaymentRecord[]> {
    const targetMonth = `${date.slice(0, 7)}-01`;
    const rows = await this.db.selectFrom("payment_items").selectAll().where("is_active", "=", true).where("start_month", "<=", targetMonth).where((eb) => eb.or([eb("end_month", "is", null), eb("end_month", ">=", targetMonth)])).execute();
    for (const row of rows) {
      const due = row.payment_type === "monthly" ? monthlyDueDate(targetMonth, row.payment_day!) : String(row.specific_payment_date);
      if (due !== date) continue;
      await this.db.insertInto("payment_records").values({ payment_item_id: String(row.id), group_id: String(row.group_id), payer_member_id: String(row.payer_member_id), target_month: targetMonth, item_name_snapshot: row.name, amount_snapshot: Number(row.amount), payment_method_snapshot: row.payment_method, due_date: due, status: "pending", request_notified_at: null, notified_at: null, overdue_notified_at: null, paid_at: null, completed_by_member_id: null }).ignore().execute();
    }
    return (await this.db.selectFrom("payment_records").selectAll().where("due_date", "=", date).execute()).map(record);
  }
  async listRecords(groupId: string, targetMonth: string, payerMemberId?: string) {
    let query = this.db.selectFrom("payment_records").selectAll().where("group_id", "=", groupId).where("target_month", "=", targetMonth);
    if (payerMemberId) query = query.where("payer_member_id", "=", payerMemberId);
    return (await query.execute()).map(record);
  }
  async listPendingRecordsDueBefore(date: string) {
    return (await this.db.selectFrom("payment_records").selectAll().where("status", "=", "pending").where("due_date", "<", date).orderBy("due_date").orderBy("id").execute()).map(record);
  }
  async markPaid(ids: string[], memberId: string, now: Date) {
    if (!ids.length) return 0;
    const result = await this.db.updateTable("payment_records").set({ status: "paid", paid_at: now, completed_by_member_id: memberId }).where("id", "in", ids).where("payer_member_id", "=", memberId).where("status", "=", "pending").executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
  async markNotification(ids: string[], kind: "request" | "due" | "overdue", now: Date) {
    if (!ids.length) return 0;
    const values = kind === "request" ? { request_notified_at: now } : kind === "due" ? { notified_at: now } : { overdue_notified_at: now };
    const result = await this.db.updateTable("payment_records").set(values).where("id", "in", ids).executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
