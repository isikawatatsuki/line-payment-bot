CREATE TABLE group_announcements (
  group_id INTEGER NOT NULL REFERENCES line_groups(id),
  announcement_key TEXT NOT NULL,
  announced_at TEXT NOT NULL,
  PRIMARY KEY (group_id, announcement_key)
);
