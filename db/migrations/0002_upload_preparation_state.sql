ALTER TABLE uploads DROP CONSTRAINT uploads_status_valid;

ALTER TABLE uploads ADD CONSTRAINT uploads_status_valid CHECK (status IN (
  'queued',
  'creating_session',
  'session_created',
  'uploading',
  'awaiting_confirmation',
  'retry_pending',
  'completed',
  'failed',
  'expired',
  'cancelled'
));

CREATE OR REPLACE FUNCTION upload_reserves_capacity(upload_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT upload_status IN (
    'queued',
    'creating_session',
    'session_created',
    'uploading',
    'awaiting_confirmation',
    'retry_pending',
    'completed'
  );
$$;
