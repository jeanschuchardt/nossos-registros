-- Token de acesso por evento: o link público passa a ser /e/<slug>?k=<token>.
-- O slug é legível e adivinhável; o token impede envios de quem não recebeu o link.
-- O default é volátil, então cada evento existente recebe um token próprio.
ALTER TABLE events
  ADD COLUMN access_token text NOT NULL
    DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);

ALTER TABLE events
  ADD CONSTRAINT events_access_token_format CHECK (access_token ~ '^[A-Za-z0-9_-]{16,64}$');

-- Data do evento (fuso de São Paulo). A janela de envio continua em
-- upload_starts_at/upload_ends_at; event_date é a referência operacional
-- para liberar 24 h antes e encerrar 7 dias depois.
ALTER TABLE events ADD COLUMN event_date date;

-- Decisão de 03/11/2026: sem teto fixo de eventos ativos; o limite real é a
-- capacidade do Drive, controlada operacionalmente.
DROP TRIGGER events_enforce_active_limit ON events;
DROP FUNCTION enforce_active_event_limit();

-- Origem do upload (hash do IP), para investigar abuso sem guardar o IP.
ALTER TABLE uploads ADD COLUMN client_key_hash text;
