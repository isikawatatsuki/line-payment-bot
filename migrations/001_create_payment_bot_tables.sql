CREATE TABLE line_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  line_group_id VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_line_groups_line_group_id (line_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE line_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  line_user_id VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at DATETIME(3) NOT NULL,
  left_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_line_members_group_user (group_id, line_user_id),
  KEY ix_line_members_group_active (group_id, is_active),
  CONSTRAINT fk_line_members_group FOREIGN KEY (group_id) REFERENCES line_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payment_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  start_month DATE NOT NULL,
  end_month DATE NULL,
  payment_type ENUM('monthly', 'one_time') NOT NULL,
  payment_day TINYINT UNSIGNED NULL,
  specific_payment_date DATE NULL,
  payer_member_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  note TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_member_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_payment_items_due (group_id, is_active, payment_type, payment_day),
  CONSTRAINT ck_payment_items_amount CHECK (amount >= 1),
  CONSTRAINT ck_payment_items_schedule CHECK (
    (payment_type = 'monthly' AND payment_day BETWEEN 1 AND 31 AND specific_payment_date IS NULL)
    OR (payment_type = 'one_time' AND payment_day IS NULL AND specific_payment_date IS NOT NULL)
  ),
  CONSTRAINT fk_payment_items_group FOREIGN KEY (group_id) REFERENCES line_groups(id),
  CONSTRAINT fk_payment_items_payer FOREIGN KEY (payer_member_id) REFERENCES line_members(id),
  CONSTRAINT fk_payment_items_creator FOREIGN KEY (created_by_member_id) REFERENCES line_members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payment_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_item_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  payer_member_id BIGINT UNSIGNED NOT NULL,
  target_month DATE NOT NULL,
  item_name_snapshot VARCHAR(255) NOT NULL,
  amount_snapshot BIGINT UNSIGNED NOT NULL,
  due_date DATE NOT NULL,
  status ENUM('pending', 'paid', 'cancelled') NOT NULL DEFAULT 'pending',
  notified_at DATETIME(3) NULL,
  paid_at DATETIME(3) NULL,
  completed_by_member_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_records_item_month (payment_item_id, target_month),
  KEY ix_payment_records_summary (group_id, payer_member_id, target_month, status),
  CONSTRAINT fk_payment_records_item FOREIGN KEY (payment_item_id) REFERENCES payment_items(id),
  CONSTRAINT fk_payment_records_group FOREIGN KEY (group_id) REFERENCES line_groups(id),
  CONSTRAINT fk_payment_records_payer FOREIGN KEY (payer_member_id) REFERENCES line_members(id),
  CONSTRAINT fk_payment_records_completer FOREIGN KEY (completed_by_member_id) REFERENCES line_members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE conversation_states (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  current_action VARCHAR(32) NOT NULL,
  current_step VARCHAR(32) NOT NULL,
  temporary_data JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversation_states_group_member (group_id, member_id),
  KEY ix_conversation_states_expiry (expires_at),
  CONSTRAINT fk_conversation_states_group FOREIGN KEY (group_id) REFERENCES line_groups(id),
  CONSTRAINT fk_conversation_states_member FOREIGN KEY (member_id) REFERENCES line_members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE processed_line_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  line_event_id VARCHAR(128) NOT NULL,
  processed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_processed_line_events_event_id (line_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
