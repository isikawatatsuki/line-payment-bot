CREATE TABLE dashboard_login_attempts (
  attempt_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX ix_dashboard_login_attempts_updated
  ON dashboard_login_attempts(updated_at);
