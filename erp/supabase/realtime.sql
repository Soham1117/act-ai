-- =====================================================================
-- Enable Supabase Realtime on the notification_recipients table.
-- Run this once in your Supabase project's SQL editor (or via the
-- dashboard: Database → Publications → supabase_realtime → add tables).
-- =====================================================================

-- Add the table to the realtime publication. Idempotent.
ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_recipients;

-- (Optional, recommended) Make sure REPLICA IDENTITY is set so payload.old
-- carries enough columns for the UPDATE listener (we use old.read).
ALTER TABLE public.notification_recipients REPLICA IDENTITY FULL;

-- Verify:
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'notification_recipients';
