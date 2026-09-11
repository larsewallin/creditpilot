
-- Create agent_runs table
CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  agent_name text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  customers_scanned integer DEFAULT 0,
  conditions_found integer DEFAULT 0,
  messages_composed integer DEFAULT 0,
  actions_taken integer DEFAULT 0,
  summary text,
  triggered_by text
);

-- Create agent_messages table
CREATE TABLE public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  customer_id uuid REFERENCES public.customers(id),
  agent_name text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  template_type text,
  recipient_type text,
  recipient_name text,
  recipient_email text,
  subject text,
  body text,
  status text DEFAULT 'sent',
  delivered_via text,
  invoice_ids uuid[],
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create pending_actions table
CREATE TABLE public.pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  customer_id uuid REFERENCES public.customers(id),
  agent_name text NOT NULL,
  message_id uuid REFERENCES public.agent_messages(id),
  action_type text NOT NULL,
  rationale text,
  current_value numeric,
  proposed_value numeric,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read agent_runs" ON public.agent_runs FOR SELECT USING (true);
CREATE POLICY "Public insert agent_runs" ON public.agent_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update agent_runs" ON public.agent_runs FOR UPDATE USING (true) WITH CHECK (true);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read agent_messages" ON public.agent_messages FOR SELECT USING (true);
CREATE POLICY "Public insert agent_messages" ON public.agent_messages FOR INSERT WITH CHECK (true);

ALTER TABLE public.pending_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read pending_actions" ON public.pending_actions FOR SELECT USING (true);
CREATE POLICY "Public update pending_actions" ON public.pending_actions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public insert pending_actions" ON public.pending_actions FOR INSERT WITH CHECK (true);

-- Allow UPDATE on customers for credit limit changes
DROP POLICY IF EXISTS "Public update customers" ON public.customers;
CREATE POLICY "Public update customers" ON public.customers FOR UPDATE USING (true) WITH CHECK (true);

-- Allow INSERT on credit_actions for logging
DROP POLICY IF EXISTS "Public insert credit_actions" ON public.credit_actions;
CREATE POLICY "Public insert credit_actions" ON public.credit_actions FOR INSERT WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_actions;
