import "server-only";
import { database } from "@/lib/db";
import type { EventStatus } from "@/lib/event-availability";

export { eventAvailability } from "@/lib/event-availability";

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  status: EventStatus;
  driveFolderId: string;
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
  upload_starts_at: Date | null;
  upload_ends_at: Date | null;
  capacity_bytes: string;
  max_file_size_bytes: string;
}

export async function findEventBySlug(slug: string): Promise<EventRecord | null> {
  const result = await database.query<EventRow>(`
    SELECT id, slug, name, status, drive_folder_id, upload_starts_at, upload_ends_at,
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
    uploadStartsAt: row.upload_starts_at,
    uploadEndsAt: row.upload_ends_at,
    capacityBytes: Number(row.capacity_bytes),
    maxFileSizeBytes: Number(row.max_file_size_bytes)
  };
}
