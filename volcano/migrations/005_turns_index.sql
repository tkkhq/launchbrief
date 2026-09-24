CREATE INDEX IF NOT EXISTS launch_turns_idea_recent ON launch_turns(idea_id, created_at DESC);
