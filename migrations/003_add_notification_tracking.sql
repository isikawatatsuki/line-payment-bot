ALTER TABLE payment_records
  ADD COLUMN request_notified_at DATETIME NULL AFTER status,
  ADD COLUMN overdue_notified_at DATETIME NULL AFTER notified_at,
  ADD INDEX ix_payment_records_overdue (status, due_date, overdue_notified_at);
