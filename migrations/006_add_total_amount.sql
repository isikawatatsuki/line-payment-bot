ALTER TABLE payment_items
  ADD COLUMN total_amount BIGINT UNSIGNED NULL AFTER amount;
