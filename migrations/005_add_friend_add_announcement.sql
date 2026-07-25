ALTER TABLE line_groups
  ADD COLUMN friend_add_announced_at DATETIME(3) NULL AFTER is_active;
