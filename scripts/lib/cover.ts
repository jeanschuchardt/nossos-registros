import { readFile } from "node:fs/promises";
import type pg from "pg";
import { processCoverImage } from "../../lib/cover-image";
import { UsageError } from "./cli";

/** Lê, trata e grava a capa do evento. Substitui a capa anterior, se houver. */
export async function saveCover(client: pg.Client, eventId: string, path: string): Promise<string> {
  const input = await readFile(path).catch(() => {
    throw new UsageError(`não foi possível ler a imagem ${path}.`);
  });
  const cover = await processCoverImage(input).catch((error: unknown) => {
    throw new UsageError(error instanceof Error ? error.message : "imagem inválida.");
  });
  await client.query(`
    INSERT INTO event_covers (event_id, image, mime_type, width, height)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (event_id) DO UPDATE
    SET image = EXCLUDED.image, mime_type = EXCLUDED.mime_type,
      width = EXCLUDED.width, height = EXCLUDED.height
  `, [eventId, cover.image, cover.mimeType, cover.width, cover.height]);
  return `${cover.width}×${cover.height}, ${Math.round(cover.image.length / 1024)} KB`;
}
