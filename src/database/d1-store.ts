import type { D1Database } from "@cloudflare/workers-types";
import type { NewPaymentItem, Store } from "../application/ports.js";
import type { ConversationState, Member, PaymentItem, PaymentRecord } from "../domain/types.js";
import { monthlyDueDate } from "../domain/date.js";

type Row = Record<string, unknown>;

function toMember(row: Row): Member {
  return { id: String(row.id), groupId: String(row.group_id), lineUserId: String(row.line_user_id), displayName: String(row.display_name), isActive: Boolean(row.is_active) };
}

function toItem(row: Row): PaymentItem {
  return {
    id: String(row.id), groupId: String(row.group_id), name: String(row.name), startMonth: String(row.start_month),
    endMonth: row.end_month ? String(row.end_month) : null, paymentType: row.payment_type as PaymentItem["paymentType"],
    paymentDay: row.payment_day === null ? null : Number(row.payment_day), specificPaymentDate: row.specific_payment_date ? String(row.specific_payment_date) : null,
    payerMemberId: String(row.payer_member_id), amount: Number(row.amount), paymentMethod: row.payment_method ? String(row.payment_method) : null, note: row.note ? String(row.note) : null,
    isActive: Boolean(row.is_active), createdByMemberId: String(row.created_by_member_id)
  };
}

function toRecord(row: Row): PaymentRecord {
  return {
    id: String(row.id), paymentItemId: String(row.payment_item_id), groupId: String(row.group_id), payerMemberId: String(row.payer_member_id),
    targetMonth: String(row.target_month), itemNameSnapshot: String(row.item_name_snapshot), amountSnapshot: Number(row.amount_snapshot), paymentMethodSnapshot: row.payment_method_snapshot ? String(row.payment_method_snapshot) : null,
    dueDate: String(row.due_date), status: row.status as PaymentRecord["status"], notifiedAt: row.notified_at ? new Date(String(row.notified_at)) : null,
    paidAt: row.paid_at ? new Date(String(row.paid_at)) : null, completedByMemberId: row.completed_by_member_id ? String(row.completed_by_member_id) : null
  };
}

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async claimEvent(eventId: string, now: Date) {
    const result = await this.db.prepare("INSERT OR IGNORE INTO processed_line_events (line_event_id, processed_at) VALUES (?, ?)").bind(eventId, now.toISOString()).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async ensureGroup(lineGroupId: string, displayName?: string) {
    await this.db.prepare(`INSERT INTO line_groups (line_group_id, display_name, is_active) VALUES (?, ?, 1)
      ON CONFLICT(line_group_id) DO UPDATE SET display_name = COALESCE(excluded.display_name, line_groups.display_name), is_active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(lineGroupId, displayName ?? null).run();
    const row = await this.db.prepare("SELECT id FROM line_groups WHERE line_group_id = ?").bind(lineGroupId).first<Row>();
    if (!row) throw new Error("Failed to ensure group");
    return String(row.id);
  }

  async findLineGroupId(groupId: string) {
    const row = await this.db.prepare("SELECT line_group_id FROM line_groups WHERE id = ?").bind(groupId).first<Row>();
    return row ? String(row.line_group_id) : null;
  }

  async deactivateGroup(lineGroupId: string) {
    await this.db.prepare("UPDATE line_groups SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE line_group_id = ?").bind(lineGroupId).run();
  }

  async ensureMember(groupId: string, lineUserId: string, displayName: string) {
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO line_members (group_id, line_user_id, display_name, is_active, joined_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(group_id, line_user_id) DO UPDATE SET display_name = excluded.display_name, is_active = 1, left_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(groupId, lineUserId, displayName, now).run();
    const value = await this.findMember(groupId, lineUserId);
    if (!value) throw new Error("Failed to ensure member");
    return value;
  }

  async findMember(groupId: string, lineUserId: string) {
    const row = await this.db.prepare("SELECT * FROM line_members WHERE group_id = ? AND line_user_id = ?").bind(groupId, lineUserId).first<Row>();
    return row ? toMember(row) : null;
  }

  async findMemberById(memberId: string) {
    const row = await this.db.prepare("SELECT * FROM line_members WHERE id = ?").bind(memberId).first<Row>();
    return row ? toMember(row) : null;
  }

  async deactivateMember(groupId: string, lineUserId: string, now: Date) {
    await this.db.prepare("UPDATE line_members SET is_active = 0, left_at = ?, updated_at = ? WHERE group_id = ? AND line_user_id = ?").bind(now.toISOString(), now.toISOString(), groupId, lineUserId).run();
  }

  async listActiveItems(groupId: string) {
    const result = await this.db.prepare("SELECT * FROM payment_items WHERE group_id = ? AND is_active = 1 ORDER BY id").bind(groupId).all<Row>();
    return result.results.map(toItem);
  }

  async findItem(itemId: string) {
    const row = await this.db.prepare("SELECT * FROM payment_items WHERE id = ?").bind(itemId).first<Row>();
    return row ? toItem(row) : null;
  }

  async createItem(value: NewPaymentItem) {
    const result = await this.db.prepare(`INSERT INTO payment_items
      (group_id, name, start_month, end_month, payment_type, payment_day, specific_payment_date, payer_member_id, amount, payment_method, note, is_active, created_by_member_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).bind(value.groupId, value.name, value.startMonth, value.endMonth, value.paymentType, value.paymentDay, value.specificPaymentDate, value.payerMemberId, value.amount, value.paymentMethod, value.note, value.createdByMemberId).run();
    const created = await this.findItem(String(result.meta.last_row_id));
    if (!created) throw new Error("Failed to create payment item");
    return created;
  }

  async updateItem(itemId: string, patch: Partial<NewPaymentItem>) {
    const mapping: Record<string, string> = { groupId: "group_id", startMonth: "start_month", endMonth: "end_month", paymentType: "payment_type", paymentDay: "payment_day", specificPaymentDate: "specific_payment_date", payerMemberId: "payer_member_id", createdByMemberId: "created_by_member_id" };
    const entries = Object.entries(patch).filter(([key]) => key !== "id");
    if (!entries.length) return;
    const assignments = entries.map(([key]) => `${mapping[key] ?? key} = ?`).join(", ");
    await this.db.prepare(`UPDATE payment_items SET ${assignments}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).bind(...entries.map(([, value]) => value), itemId).run();
  }

  async deactivateItem(itemId: string) {
    await this.db.prepare("UPDATE payment_items SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(itemId).run();
  }

  async getConversation(groupId: string, memberId: string) {
    const row = await this.db.prepare("SELECT * FROM conversation_states WHERE group_id = ? AND member_id = ?").bind(groupId, memberId).first<Row>();
    return row ? { groupId, memberId, currentAction: row.current_action as ConversationState["currentAction"], currentStep: String(row.current_step), temporaryData: JSON.parse(String(row.temporary_data)), expiresAt: new Date(String(row.expires_at)) } : null;
  }

  async saveConversation(state: ConversationState) {
    await this.db.prepare(`INSERT INTO conversation_states (group_id, member_id, current_action, current_step, temporary_data, expires_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(group_id, member_id) DO UPDATE SET current_action = excluded.current_action, current_step = excluded.current_step,
      temporary_data = excluded.temporary_data, expires_at = excluded.expires_at, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(state.groupId, state.memberId, state.currentAction, state.currentStep, JSON.stringify(state.temporaryData), state.expiresAt.toISOString()).run();
  }

  async clearConversation(groupId: string, memberId: string) {
    await this.db.prepare("DELETE FROM conversation_states WHERE group_id = ? AND member_id = ?").bind(groupId, memberId).run();
  }

  async createDueRecords(date: string) {
    const targetMonth = `${date.slice(0, 7)}-01`;
    const candidates = await this.db.prepare(`SELECT * FROM payment_items WHERE is_active = 1 AND start_month <= ? AND (end_month IS NULL OR end_month >= ?)`)
      .bind(targetMonth, targetMonth).all<Row>();
    const statements = [];
    for (const row of candidates.results) {
      const value = toItem(row);
      const dueDate = value.paymentType === "monthly" ? monthlyDueDate(targetMonth, value.paymentDay!) : value.specificPaymentDate;
      if (dueDate !== date) continue;
      statements.push(this.db.prepare(`INSERT OR IGNORE INTO payment_records
        (payment_item_id, group_id, payer_member_id, target_month, item_name_snapshot, amount_snapshot, payment_method_snapshot, due_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).bind(value.id, value.groupId, value.payerMemberId, targetMonth, value.name, value.amount, value.paymentMethod, dueDate));
    }
    if (statements.length) await this.db.batch(statements);
    const rows = await this.db.prepare("SELECT * FROM payment_records WHERE due_date = ?").bind(date).all<Row>();
    return rows.results.map(toRecord);
  }

  async listRecords(groupId: string, targetMonth: string, payerMemberId?: string) {
    const statement = payerMemberId
      ? this.db.prepare("SELECT * FROM payment_records WHERE group_id = ? AND target_month = ? AND payer_member_id = ? ORDER BY id").bind(groupId, targetMonth, payerMemberId)
      : this.db.prepare("SELECT * FROM payment_records WHERE group_id = ? AND target_month = ? ORDER BY id").bind(groupId, targetMonth);
    const rows = await statement.all<Row>();
    return rows.results.map(toRecord);
  }

  async markPaid(recordIds: string[], completedByMemberId: string, now: Date) {
    if (!recordIds.length) return 0;
    const placeholders = recordIds.map(() => "?").join(",");
    const result = await this.db.prepare(`UPDATE payment_records SET status = 'paid', paid_at = ?, completed_by_member_id = ?, updated_at = ?
      WHERE id IN (${placeholders}) AND payer_member_id = ? AND status = 'pending'`).bind(now.toISOString(), completedByMemberId, now.toISOString(), ...recordIds, completedByMemberId).run();
    return result.meta.changes ?? 0;
  }

  async markNotified(recordIds: string[], now: Date) {
    if (!recordIds.length) return 0;
    const placeholders = recordIds.map(() => "?").join(",");
    const result = await this.db.prepare(`UPDATE payment_records SET notified_at = ?, updated_at = ? WHERE id IN (${placeholders}) AND notified_at IS NULL`)
      .bind(now.toISOString(), now.toISOString(), ...recordIds).run();
    return result.meta.changes ?? 0;
  }
}
