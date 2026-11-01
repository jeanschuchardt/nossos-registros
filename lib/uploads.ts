import "server-only";
import type { PoolClient } from "pg";
import { database } from "@/lib/db";
import type { EventRecord } from "@/lib/events";
import type { FileMetadata } from "@/lib/validation";
import { decryptSessionUrl, encryptSessionUrl } from "@/lib/session-crypto";

export class UploadConflictError extends Error {}
export class UploadPreparationPendingError extends Error {}

interface UploadRow {
  id: string;
  event_id: string;
  idempotency_key: string;
  original_filename: string;
  drive_filename: string | null;
  mime_type: string;
  size_bytes: string;
  status: string;
  drive_file_id: string | null;
  session_url_ciphertext: string | null;
}

export interface UploadForConfirmation {
  id: string;
  eventId: string;
  eventSlug: string;
  driveFolderId: string;
  driveFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  driveFileId: string | null;
}

export type PreparedUpload =
  | { kind: "create_session"; uploadId: string }
  | { kind: "resume"; uploadId: string; sessionUrl: string; uploadName: string }
  | { kind: "confirm"; uploadId: string }
  | { kind: "completed"; uploadId: string };

function metadataMatches(row: UploadRow, metadata: FileMetadata): boolean {
  return row.original_filename === metadata.filename
    && row.mime_type === metadata.mimeType
    && Number(row.size_bytes) === metadata.size;
}

async function selectUpload(client: PoolClient, eventId: string, idempotencyKey: string): Promise<UploadRow | null> {
  const result = await client.query<UploadRow>(`
    SELECT id, event_id, idempotency_key, original_filename, drive_filename, mime_type,
      size_bytes, status, drive_file_id, session_url_ciphertext
    FROM uploads
    WHERE event_id = $1 AND idempotency_key = $2
    FOR UPDATE
  `, [eventId, idempotencyKey]);
  return result.rows[0] ?? null;
}

export async function prepareUpload(event: EventRecord, metadata: FileMetadata, idempotencyKey: string): Promise<PreparedUpload> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    let upload = await selectUpload(client, event.id, idempotencyKey);

    if (!upload) {
      const inserted = await client.query<UploadRow>(`
        INSERT INTO uploads (
          event_id, idempotency_key, original_filename, mime_type, size_bytes,
          status, attempt_count
        ) VALUES ($1, $2, $3, $4, $5, 'creating_session', 1)
        RETURNING id, event_id, idempotency_key, original_filename, drive_filename,
          mime_type, size_bytes, status, drive_file_id, session_url_ciphertext
      `, [event.id, idempotencyKey, metadata.filename, metadata.mimeType, metadata.size]);
      upload = inserted.rows[0];
      await client.query("COMMIT");
      return { kind: "create_session", uploadId: upload.id };
    }

    if (!metadataMatches(upload, metadata)) {
      throw new UploadConflictError("A chave de idempotência já pertence a outro arquivo.");
    }
    if (upload.status === "completed") {
      await client.query("COMMIT");
      return { kind: "completed", uploadId: upload.id };
    }
    if (upload.status === "awaiting_confirmation") {
      await client.query("COMMIT");
      return { kind: "confirm", uploadId: upload.id };
    }
    if (upload.session_url_ciphertext && upload.drive_filename
      && ["session_created", "uploading", "retry_pending"].includes(upload.status)) {
      const sessionUrl = decryptSessionUrl(upload.session_url_ciphertext);
      await client.query("COMMIT");
      return { kind: "resume", uploadId: upload.id, sessionUrl, uploadName: upload.drive_filename };
    }
    if (upload.status === "creating_session") {
      throw new UploadPreparationPendingError("A sessão deste upload ainda está sendo preparada.");
    }

    const claimed = await client.query(`
      UPDATE uploads
      SET status = 'creating_session', attempt_count = attempt_count + 1,
        last_error_code = NULL, last_error_message = NULL,
        session_url_ciphertext = NULL, session_expires_at = NULL
      WHERE id = $1
    `, [upload.id]);
    if (claimed.rowCount !== 1) throw new UploadConflictError("Não foi possível reiniciar o upload.");
    await client.query("COMMIT");
    return { kind: "create_session", uploadId: upload.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveUploadSession(uploadId: string, sessionUrl: string, uploadName: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
  const result = await database.query(`
    UPDATE uploads
    SET status = 'session_created', drive_filename = $2,
      session_url_ciphertext = $3, session_expires_at = $4
    WHERE id = $1 AND status = 'creating_session'
  `, [uploadId, uploadName, encryptSessionUrl(sessionUrl), expiresAt]);
  if (result.rowCount !== 1) throw new UploadConflictError("O estado do upload mudou durante a criação da sessão.");
}

export async function markUploadPreparationFailed(uploadId: string, errorCode: string): Promise<void> {
  await database.query(`
    UPDATE uploads
    SET status = 'failed', last_error_code = $2,
      last_error_message = 'Não foi possível criar a sessão no Google Drive.'
    WHERE id = $1 AND status = 'creating_session'
  `, [uploadId, errorCode]);
}

export async function getUploadForConfirmation(uploadId: string, eventSlug: string): Promise<UploadForConfirmation | null> {
  const result = await database.query<{
    id: string; event_id: string; slug: string; drive_folder_id: string;
    drive_filename: string; mime_type: string; size_bytes: string; status: string; drive_file_id: string | null;
  }>(`
    SELECT u.id, u.event_id, e.slug, e.drive_folder_id, u.drive_filename,
      u.mime_type, u.size_bytes, u.status, u.drive_file_id
    FROM uploads u
    JOIN events e ON e.id = u.event_id
    WHERE u.id = $1 AND e.slug = $2
  `, [uploadId, eventSlug]);
  const row = result.rows[0];
  if (!row || !row.drive_filename) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    eventSlug: row.slug,
    driveFolderId: row.drive_folder_id,
    driveFilename: row.drive_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    driveFileId: row.drive_file_id
  };
}

export async function markAwaitingConfirmation(uploadId: string): Promise<void> {
  await database.query(`
    UPDATE uploads
    SET status = 'awaiting_confirmation'
    WHERE id = $1 AND status IN ('session_created', 'uploading', 'retry_pending', 'awaiting_confirmation')
  `, [uploadId]);
}

export async function completeUpload(uploadId: string, driveFileId: string): Promise<void> {
  const result = await database.query(`
    UPDATE uploads
    SET status = 'completed', drive_file_id = $2, confirmed_bytes = size_bytes,
      completed_at = COALESCE(completed_at, now()), session_url_ciphertext = NULL,
      session_expires_at = NULL, last_error_code = NULL, last_error_message = NULL
    WHERE id = $1 AND status IN ('awaiting_confirmation', 'completed')
  `, [uploadId, driveFileId]);
  if (result.rowCount !== 1) throw new UploadConflictError("O upload não pode ser concluído no estado atual.");
}
