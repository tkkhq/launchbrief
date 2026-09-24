CREATE POLICY launch_credits_select_own ON launch_credits FOR SELECT USING (user_id = auth.uid() AND auth.role() = 'authenticated');
