CREATE TABLE group_announcements (
  group_id BIGINT UNSIGNED NOT NULL,
  announcement_key VARCHAR(64) NOT NULL,
  announced_at DATETIME(3) NOT NULL,
  PRIMARY KEY (group_id, announcement_key),
  CONSTRAINT fk_group_announcements_group FOREIGN KEY (group_id) REFERENCES line_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
