CREATE INDEX IF NOT EXISTS launch_credits_available ON launch_credits(user_id, created_at) WHERE spent_at IS NULL;
