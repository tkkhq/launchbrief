CREATE POLICY launch_turns_select_own ON launch_turns FOR SELECT USING (user_id = auth.uid() AND auth.role() = 'authenticated');
