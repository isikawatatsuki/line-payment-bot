CREATE TABLE dashboard_login_attempts (
  attempt_key VARCHAR(64) PRIMARY KEY,
  failure_count INT NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  blocked_until DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX ix_dashboard_login_attempts_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
