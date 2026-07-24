ALTER TABLE payment_records ADD COLUMN request_notified_at TEXT;
ALTER TABLE payment_records ADD COLUMN overdue_notified_at TEXT;

CREATE INDEX ix_payment_records_overdue
  ON payment_records(status, due_date, overdue_notified_at);
