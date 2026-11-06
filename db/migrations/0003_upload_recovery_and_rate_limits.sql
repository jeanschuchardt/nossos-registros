CREATE TABLE rate_limit_windows (
  key_hash text PRIMARY KEY,
  request_count integer NOT NULL,
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_count_positive CHECK (request_count > 0)
);

CREATE INDEX rate_limit_windows_reset_idx ON rate_limit_windows (reset_at);

CREATE FUNCTION consume_rate_limit(
  input_key_hash text,
  input_limit integer,
  input_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  current_count integer;
BEGIN
  IF input_limit < 1 OR input_window_seconds < 1 THEN
    RAISE EXCEPTION 'Configuração de rate limit inválida.';
  END IF;

  INSERT INTO rate_limit_windows (key_hash, request_count, reset_at)
  VALUES (input_key_hash, 1, now() + make_interval(secs => input_window_seconds))
  ON CONFLICT (key_hash) DO UPDATE
  SET request_count = CASE
        WHEN rate_limit_windows.reset_at <= now() THEN 1
        ELSE rate_limit_windows.request_count + 1
      END,
      reset_at = CASE
        WHEN rate_limit_windows.reset_at <= now()
          THEN now() + make_interval(secs => input_window_seconds)
        ELSE rate_limit_windows.reset_at
      END,
      updated_at = now()
  RETURNING request_count INTO current_count;

  RETURN current_count <= input_limit;
END;
$$;

CREATE INDEX uploads_stale_preparation_idx
  ON uploads (updated_at)
  WHERE status = 'creating_session';
