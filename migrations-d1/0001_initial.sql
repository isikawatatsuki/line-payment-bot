PRAGMA foreign_keys = ON;

CREATE TABLE line_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_group_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE line_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES line_groups(id),
  line_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(group_id, line_user_id)
);
CREATE INDEX ix_line_members_group_active ON line_members(group_id, is_active);

CREATE TABLE payment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES line_groups(id),
  name TEXT NOT NULL,
  start_month TEXT NOT NULL,
  end_month TEXT,
  payment_type TEXT NOT NULL CHECK(payment_type IN ('monthly', 'one_time')),
  payment_day INTEGER,
  specific_payment_date TEXT,
  payer_member_id INTEGER NOT NULL REFERENCES line_members(id),
  amount INTEGER NOT NULL CHECK(amount >= 1),
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by_member_id INTEGER NOT NULL REFERENCES line_members(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK((payment_type = 'monthly' AND payment_day BETWEEN 1 AND 31 AND specific_payment_date IS NULL)
     OR (payment_type = 'one_time' AND payment_day IS NULL AND specific_payment_date IS NOT NULL))
);
CREATE INDEX ix_payment_items_due ON payment_items(group_id, is_active, payment_type, payment_day);

CREATE TABLE payment_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_item_id INTEGER NOT NULL REFERENCES payment_items(id),
  group_id INTEGER NOT NULL REFERENCES line_groups(id),
  payer_member_id INTEGER NOT NULL REFERENCES line_members(id),
  target_month TEXT NOT NULL,
  item_name_snapshot TEXT NOT NULL,
  amount_snapshot INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled')),
  notified_at TEXT,
  paid_at TEXT,
  completed_by_member_id INTEGER REFERENCES line_members(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(payment_item_id, target_month)
);
CREATE INDEX ix_payment_records_summary ON payment_records(group_id, payer_member_id, target_month, status);

CREATE TABLE conversation_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES line_groups(id),
  member_id INTEGER NOT NULL REFERENCES line_members(id),
  current_action TEXT NOT NULL,
  current_step TEXT NOT NULL,
  temporary_data TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(group_id, member_id)
);
CREATE INDEX ix_conversation_states_expiry ON conversation_states(expires_at);

CREATE TABLE processed_line_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_event_id TEXT NOT NULL UNIQUE,
  processed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
