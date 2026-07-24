ALTER TABLE payment_items
  ADD COLUMN payment_method VARCHAR(255) NULL AFTER amount;

ALTER TABLE payment_records
  ADD COLUMN payment_method_snapshot VARCHAR(255) NULL AFTER amount_snapshot;
