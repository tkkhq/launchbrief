CREATE POLICY launch_ideas_select_own ON launch_ideas FOR SELECT USING (user_id = auth.uid() AND auth.role() = 'authenticated');
