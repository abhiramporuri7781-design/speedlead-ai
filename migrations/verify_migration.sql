-- ====================================================================
-- Verification queries for Migration 001
-- Read-only checks to confirm successful application
-- ====================================================================

-- 1. Verify the three new columns exist on public.businesses
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'businesses'
  AND column_name IN ('whatsapp_provider', 'interakt_api_key', 'meta_access_token')
ORDER BY column_name;

-- 2. Verify public.messages table exists
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'messages';

-- 3. Verify idx_messages_idempotency and idx_messages_business_lead indexes exist
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'messages'
  AND indexname IN ('idx_messages_idempotency', 'idx_messages_business_lead')
ORDER BY indexname;

-- 4. Verify Row Level Security (RLS) is enabled on public.messages
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname = 'messages';
