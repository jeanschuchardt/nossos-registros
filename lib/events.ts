import "server-only";
import { readQuery } from "@/lib/db";
import type { EventStatus } from "@/lib/event-availability";
import { safeEqual } from "@/lib/session-crypto";

export { eventAvailability } from "@/lib/event-availability";

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  status: EventStatus;
  driveFolderId: string;
  accessToken: string;
  uploadStartsAt: Date | null;
  uploadEndsAt: Date | null;
  capacityBytes: number;
  maxFileSizeBytes: number;
}

interface EventRow {
  id: string;
  slug: string;
  name: string;
  status: EventStatus;
  drive_folder_id: string;
  access_token: string;
  upload_starts_at: Date | null;
  upload_ends_at: Date | null;
  capacity_bytes: string;
  max_file_size_bytes: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function findEventBySlug(slug: string): Promise<EventRecord | null> {
  if (!slug || slug.length > 100 || !SLUG_PATTERN.test(slug)) return null;
  const result = await readQuery<EventRow>(`
    SELECT id, slug, name, status, drive_folder_id, access_token, upload_starts_at, upload_ends_at,
      capacity_bytes, max_file_size_bytes
    FROM events
    WHERE slug = $1
    LIMIT 1
  `, [slug]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    driveFolderId: row.drive_folder_id,
    accessToken: row.access_token,
    uploadStartsAt: row.upload_starts_at,
    uploadEndsAt: row.upload_ends_at,
    capacityBytes: Number(row.capacity_bytes),
    maxFileSizeBytes: Number(row.max_file_size_bytes)
  };
}

/**
 * Resolve o evento somente com o token correto. Slug existente com token
 * errado responde igual a slug inexistente, para não confirmar quais eventos existem.
 */
export async function findEventWithAccess(slug: string, token: string | null | undefined): Promise<EventRecord | null> {
  if (!token) return null;
  const event = await findEventBySlug(slug);
  if (!event || !safeEqual(token, event.accessToken)) return null;
  return event;
}
