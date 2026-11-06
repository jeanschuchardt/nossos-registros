-- Foto de capa opcional por evento, escolhida pelo contratante. Fica em tabela
-- própria para que a consulta do evento não carregue os bytes da imagem.
-- A imagem já chega redimensionada e sem metadados (ver lib/cover-image.ts).
CREATE TABLE event_covers (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  image bytea NOT NULL,
  mime_type text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_covers_mime_valid CHECK (mime_type IN ('image/webp', 'image/jpeg')),
  -- Teto de segurança: a capa processada tem cerca de 200 KB.
  CONSTRAINT event_covers_size_limit CHECK (octet_length(image) <= 2097152),
  CONSTRAINT event_covers_dimensions_positive CHECK (width > 0 AND height > 0)
);

CREATE TRIGGER event_covers_set_updated_at
BEFORE UPDATE ON event_covers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
