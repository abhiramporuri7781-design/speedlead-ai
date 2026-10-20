BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT NOT NULL DEFAULT 'interakt',
  ADD COLUMN IF NOT EXISTS interakt_api_key TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token TEXT;

ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_whatsapp_provider_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_whatsapp_provider_check CHECK (whatsapp_provider IN ('interakt', 'meta'));

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CONSTRAINT messages_direction_check CHECK (direction IN ('in', 'out')),
  sender TEXT NOT NULL CONSTRAINT messages_sender_check CHECK (sender IN ('customer', 'bot', 'agent', 'system')),
  content_type TEXT DEFAULT 'Text' NOT NULL,
  body TEXT,
  provider TEXT DEFAULT 'interakt' NOT NULL CONSTRAINT messages_provider_check CHECK (provider IN ('interakt', 'meta')),
  provider_message_id TEXT,
  status TEXT DEFAULT 'received',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency
  ON public.messages (business_id, provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_business_lead
  ON public.messages (business_id, lead_id, created_at DESC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service_role full access to messages" ON public.messages;
CREATE POLICY "Allow service_role full access to messages"
  ON public.messages FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
