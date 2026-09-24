CREATE INDEX IF NOT EXISTS launch_ideas_owner_recent ON launch_ideas(user_id, created_at DESC);
