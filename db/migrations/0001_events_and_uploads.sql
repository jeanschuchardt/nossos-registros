CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  drive_folder_id text NOT NULL UNIQUE,
  upload_starts_at timestamptz,
  upload_ends_at timestamptz,
  capacity_bytes bigint NOT NULL DEFAULT 107374182400,
  max_file_size_bytes bigint NOT NULL DEFAULT 10737418240,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_slug_format CHECK (
    char_length(slug) BETWEEN 3 AND 100
    AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT events_name_length CHECK (char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT events_status_valid CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  CONSTRAINT events_upload_window_valid CHECK (
    upload_starts_at IS NULL
    OR upload_ends_at IS NULL
    OR upload_ends_at > upload_starts_at
  ),
  CONSTRAINT events_capacity_positive CHECK (capacity_bytes > 0),
  CONSTRAINT events_max_file_size_valid CHECK (
    max_file_size_bytes > 0 AND max_file_size_bytes <= capacity_bytes
  )
);

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  original_filename text NOT NULL,
  drive_filename text,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  confirmed_bytes bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  drive_file_id text UNIQUE,
  session_url_ciphertext text,
  session_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT uploads_event_idempotency_unique UNIQUE (event_id, idempotency_key),
  CONSTRAINT uploads_filename_length CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  CONSTRAINT uploads_drive_filename_length CHECK (
    drive_filename IS NULL OR char_length(drive_filename) BETWEEN 1 AND 255
  ),
  CONSTRAINT uploads_mime_type_length CHECK (char_length(mime_type) BETWEEN 1 AND 127),
  CONSTRAINT uploads_size_positive CHECK (size_bytes > 0),
  CONSTRAINT uploads_confirmed_bytes_valid CHECK (
    confirmed_bytes >= 0 AND confirmed_bytes <= size_bytes
  ),
  CONSTRAINT uploads_attempt_count_valid CHECK (attempt_count >= 0),
  CONSTRAINT uploads_status_valid CHECK (status IN (
    'queued',
    'session_created',
    'uploading',
    'awaiting_confirmation',
    'retry_pending',
    'completed',
    'failed',
    'expired',
    'cancelled'
  )),
  CONSTRAINT uploads_error_code_length CHECK (
    last_error_code IS NULL OR char_length(last_error_code) <= 80
  ),
  CONSTRAINT uploads_error_message_length CHECK (
    last_error_message IS NULL OR char_length(last_error_message) <= 1000
  ),
  CONSTRAINT uploads_completed_fields CHECK (
    status <> 'completed' OR (drive_file_id IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT uploads_cancelled_fields CHECK (
    status <> 'cancelled' OR cancelled_at IS NOT NULL
  )
);

CREATE INDEX uploads_event_status_idx ON uploads (event_id, status);
CREATE INDEX uploads_reconciliation_idx
  ON uploads (status, updated_at)
  WHERE status IN ('session_created', 'uploading', 'awaiting_confirmation', 'retry_pending');
CREATE INDEX uploads_session_expiry_idx
  ON uploads (session_expires_at)
  WHERE session_expires_at IS NOT NULL;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_set_updated_at
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER uploads_set_updated_at
BEFORE UPDATE ON uploads
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION enforce_active_event_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  active_count integer;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('nossos-registros-active-events', 0));
    SELECT count(*) INTO active_count
    FROM events
    WHERE status = 'active' AND id <> NEW.id;

    IF active_count >= 5 THEN
      RAISE EXCEPTION 'O limite de cinco eventos ativos foi atingido.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_enforce_active_limit
BEFORE INSERT OR UPDATE OF status ON events
FOR EACH ROW EXECUTE FUNCTION enforce_active_event_limit();

CREATE FUNCTION upload_reserves_capacity(upload_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT upload_status IN (
    'queued',
    'session_created',
    'uploading',
    'awaiting_confirmation',
    'retry_pending',
    'completed'
  );
$$;

CREATE FUNCTION enforce_event_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event_capacity bigint;
  already_reserved numeric;
BEGIN
  IF NOT upload_reserves_capacity(NEW.status) THEN
    RETURN NEW;
  END IF;

  SELECT capacity_bytes INTO event_capacity
  FROM events
  WHERE id = NEW.event_id
  FOR UPDATE;

  IF event_capacity IS NULL THEN
    RAISE EXCEPTION 'Evento não encontrado.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT COALESCE(sum(size_bytes), 0) INTO already_reserved
  FROM uploads
  WHERE event_id = NEW.event_id
    AND upload_reserves_capacity(status)
    AND id <> NEW.id;

  IF already_reserved + NEW.size_bytes > event_capacity THEN
    RAISE EXCEPTION 'A capacidade do evento seria excedida.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER uploads_enforce_event_capacity
BEFORE INSERT OR UPDATE OF event_id, size_bytes, status ON uploads
FOR EACH ROW EXECUTE FUNCTION enforce_event_capacity();

CREATE VIEW event_storage_usage AS
SELECT
  e.id AS event_id,
  e.capacity_bytes,
  COALESCE(sum(u.size_bytes) FILTER (WHERE u.status = 'completed'), 0)::bigint AS used_bytes,
  COALESCE(sum(u.size_bytes) FILTER (
    WHERE u.status IN ('queued', 'session_created', 'uploading', 'awaiting_confirmation', 'retry_pending')
  ), 0)::bigint AS reserved_bytes,
  (
    e.capacity_bytes
    - COALESCE(sum(u.size_bytes) FILTER (
      WHERE u.status IN ('queued', 'session_created', 'uploading', 'awaiting_confirmation', 'retry_pending', 'completed')
    ), 0)
  )::bigint AS available_bytes
FROM events e
LEFT JOIN uploads u ON u.event_id = e.id
GROUP BY e.id, e.capacity_bytes;
