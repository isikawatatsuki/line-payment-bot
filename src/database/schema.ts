import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface LineGroupsTable {
  id: Generated<string>; line_group_id: string; display_name: string | null; is_active: boolean;
  created_at: Timestamp; updated_at: Timestamp;
}
export interface LineMembersTable {
  id: Generated<string>; group_id: string; line_user_id: string; display_name: string; is_active: boolean;
  joined_at: Timestamp; left_at: Timestamp | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface PaymentItemsTable {
  id: Generated<string>; group_id: string; name: string; start_month: string; end_month: string | null;
  payment_type: "monthly" | "one_time"; payment_day: number | null; specific_payment_date: string | null;
  payer_member_id: string; amount: number; total_amount: number | null; payment_method: string | null; note: string | null; is_active: boolean;
  created_by_member_id: string; created_at: Timestamp; updated_at: Timestamp;
}
export interface PaymentRecordsTable {
  id: Generated<string>; payment_item_id: string; group_id: string; payer_member_id: string;
  target_month: string; item_name_snapshot: string; amount_snapshot: number; payment_method_snapshot: string | null; due_date: string;
  status: "pending" | "paid" | "cancelled"; request_notified_at: Timestamp | null; notified_at: Timestamp | null;
  overdue_notified_at: Timestamp | null; paid_at: Timestamp | null;
  completed_by_member_id: string | null; created_at: Timestamp; updated_at: Timestamp;
}
export interface ProcessedLineEventsTable {
  id: Generated<string>; line_event_id: string; processed_at: Timestamp; created_at: Timestamp;
}
export interface GroupAnnouncementsTable {
  group_id: string; announcement_key: string; announced_at: Timestamp;
}
export interface Database {
  line_groups: LineGroupsTable;
  line_members: LineMembersTable;
  payment_items: PaymentItemsTable;
  payment_records: PaymentRecordsTable;
  processed_line_events: ProcessedLineEventsTable;
  group_announcements: GroupAnnouncementsTable;
}

export type PaymentItemRow = Selectable<PaymentItemsTable>;
export type LineMemberRow = Selectable<LineMembersTable>;
export type PaymentRecordRow = Selectable<PaymentRecordsTable>;
export type NewPaymentItemRow = Insertable<PaymentItemsTable>;
export type PaymentItemUpdate = Updateable<PaymentItemsTable>;
