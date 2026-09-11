
-- Allow public DELETE on pending_actions, agent_messages, agent_runs, credit_actions for demo reset
CREATE POLICY "Public delete pending_actions" ON public.pending_actions FOR DELETE USING (true);
CREATE POLICY "Public delete agent_messages" ON public.agent_messages FOR DELETE USING (true);
CREATE POLICY "Public delete agent_runs" ON public.agent_runs FOR DELETE USING (true);
CREATE POLICY "Public delete credit_actions" ON public.credit_actions FOR DELETE USING (true);
