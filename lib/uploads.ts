import "server-only";
import type { PoolClient } from "pg";
import { database, readQuery } from "@/lib/db";
import type { EventRecord } from "@/lib/events";
import type { FileMetadata } from "@/lib/validation";
import { decryptSessionUrl, encryptSessionUrl } from "@/lib/session-crypto";
import { isPreparationStale, isSessionUsable } from "@/lib/upload-recovery";

export class UploadConflictError extends Error {}
export class UploadPreparationPendingError extends Error {}
export class EventCapacityExceededError extends Error {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUploadId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function preparationTimeoutMs(): number {
  return Math.max(30_000, Number(process.env.UPLOAD_PREPARATION_TIMEOUT_MS ?? "120000") || 120_000);
}

/** Sem progresso registrado por este tempo, a reserva de capacidade é liberada. */
function abandonedAfterMs(): number {
  return Math.max(10 * 60_000, Number(process.env.UPLOAD_ABANDONED_TIMEOUT_MS ?? "7200000") || 7_200_000);
}

function isCapacityViolation(error: unknown): boolean {
  return error instanceof Error
    && (error as { code?: string }).code === "23514"
    && error.message.includes("capacidade");
}

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
  session_expires_at: Date | null;
  updated_at: Date;
}

export interface UploadForConfirmation {
  id: string;
  eventId: string;
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
      size_bytes, status, drive_file_id, session_url_ciphertext, session_expires_at, updated_at
    FROM uploads
    WHERE event_id = $1 AND idempotency_key = $2
    FOR UPDATE
  `, [eventId, idempotencyKey]);
  return result.rows[0] ?? null;
}

/**
 * Libera reservas de uploads parados no evento. Roda dentro da transação de
 * preparação, antes da checagem de capacidade, para que abas fechadas e sessões
 * abandonadas não prendam espaço. A sessão do Drive é mantida: se o convidado
 * voltar, o upload é reativado (sujeito à capacidade) sem perder o progresso.
 */
async function expireAbandonedUploads(client: PoolClient, eventId: string): Promise<void> {
  await client.query(`
    UPDATE uploads
    SET status = 'expired', last_error_code = 'abandoned',
      last_error_message = 'Upload sem atividade; reserva de capacidade liberada.'
    WHERE event_id = $1
      AND (
        (status = 'creating_session' AND updated_at < now() - make_interval(secs => $2::double precision / 1000))
        OR (status IN ('session_created', 'uploading', 'retry_pending')
          AND updated_at < now() - make_interval(secs => $3::double precision / 1000))
      )
  `, [eventId, preparationTimeoutMs(), abandonedAfterMs()]);
}

export async function prepareUpload(
  event: EventRecord,
  metadata: FileMetadata,
  idempotencyKey: string,
  clientKeyHash: string
): Promise<PreparedUpload> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await expireAbandonedUploads(client, event.id);
    let upload = await selectUpload(client, event.id, idempotencyKey);

    if (!upload) {
      const inserted = await client.query<UploadRow>(`
        INSERT INTO uploads (
          event_id, idempotency_key, original_filename, mime_type, size_bytes,
          status, attempt_count, client_key_hash
        ) VALUES ($1, $2, $3, $4, $5, 'creating_session', 1, $6)
        RETURNING id
      `, [event.id, idempotencyKey, metadata.filename, metadata.mimeType, metadata.size, clientKeyHash]);
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
    const now = new Date();
    if (upload.session_url_ciphertext && upload.drive_filename
      && isSessionUsable(upload.session_expires_at, now)
      && ["session_created", "uploading", "retry_pending", "expired"].includes(upload.status)) {
      if (upload.status === "expired") {
        // Reativar volta a reservar capacidade; o trigger recusa se o evento lotou.
        await client.query(`
          UPDATE uploads SET status = 'session_created', last_error_code = NULL, last_error_message = NULL
          WHERE id = $1
        `, [upload.id]);
      }
      const sessionUrl = decryptSessionUrl(upload.session_url_ciphertext);
      await client.query("COMMIT");
      return { kind: "resume", uploadId: upload.id, sessionUrl, uploadName: upload.drive_filename };
    }
    if (upload.status === "creating_session"
      && !isPreparationStale(upload.updated_at, now, preparationTimeoutMs())) {
      throw new UploadPreparationPendingError("A sessão deste upload ainda está sendo preparada.");
    }

    const claimed = await client.query(`
      UPDATE uploads
      SET status = 'creating_session', attempt_count = attempt_count + 1,
        last_error_code = NULL, last_error_message = NULL,
        session_url_ciphertext = NULL, session_expires_at = NULL,
        confirmed_bytes = 0
      WHERE id = $1
    `, [upload.id]);
    if (claimed.rowCount !== 1) throw new UploadConflictError("Não foi possível reiniciar o upload.");
    await client.query("COMMIT");
    return { kind: "create_session", uploadId: upload.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isCapacityViolation(error)) {
      throw new EventCapacityExceededError("Este evento atingiu o limite de armazenamento.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function saveUploadSession(uploadId: string, sessionUrl: string, uploadName: string): Promise<void> {
  // Sessões resumíveis do Drive valem cerca de uma semana; 6 dias deixa margem.
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

export async function getUploadForConfirmation(uploadId: string): Promise<UploadForConfirmation | null> {
  const result = await readQuery<{
    id: string; event_id: string; drive_folder_id: string;
    drive_filename: string | null; mime_type: string; size_bytes: string; status: string; drive_file_id: string | null;
  }>(`
    SELECT u.id, u.event_id, e.drive_folder_id, u.drive_filename,
      u.mime_type, u.size_bytes, u.status, u.drive_file_id
    FROM uploads u
    JOIN events e ON e.id = u.event_id
    WHERE u.id = $1
  `, [uploadId]);
  const row = result.rows[0];
  if (!row || !row.drive_filename) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    driveFolderId: row.drive_folder_id,
    driveFilename: row.drive_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    driveFileId: row.drive_file_id
  };
}

/** Retorna false se o upload não pode ser confirmado (ex.: evento lotou depois de expirar). */
export async function markAwaitingConfirmation(uploadId: string): Promise<boolean> {
  try {
    const result = await database.query(`
      UPDATE uploads
      SET status = 'awaiting_confirmation'
      WHERE id = $1 AND status IN ('session_created', 'uploading', 'retry_pending', 'expired', 'awaiting_confirmation')
    `, [uploadId]);
    return result.rowCount === 1;
  } catch (error) {
    if (isCapacityViolation(error)) return false;
    throw error;
  }
}

export async function recordUploadProgress(
  uploadId: string,
  confirmedBytes: number,
  state: "uploading" | "retry_pending" | "expired"
): Promise<boolean> {
  try {
    const result = await database.query(`
      UPDATE uploads u
      SET status = $3, confirmed_bytes = GREATEST(u.confirmed_bytes, $2),
        session_url_ciphertext = CASE WHEN $3 = 'expired' THEN NULL ELSE session_url_ciphertext END,
        session_expires_at = CASE WHEN $3 = 'expired' THEN NULL ELSE session_expires_at END,
        last_error_code = CASE
          WHEN $3 = 'retry_pending' THEN 'network_retry'
          WHEN $3 = 'expired' THEN 'drive_session_expired'
          ELSE NULL
        END,
        last_error_message = CASE
          WHEN $3 = 'retry_pending' THEN 'Aguardando nova tentativa do navegador.'
          WHEN $3 = 'expired' THEN 'A sessão resumível do Google Drive expirou.'
          ELSE NULL
        END
      WHERE u.id = $1
        AND u.status IN ('session_created', 'uploading', 'retry_pending', 'expired')
        AND $2 >= 0 AND $2 <= u.size_bytes
    `, [uploadId, confirmedBytes, state]);
    return result.rowCount === 1;
  } catch (error) {
    // Upload expirado tentando voltar a um evento lotado: o Drive segue sendo a
    // fonte do progresso; a confirmação decide o desfecho.
    if (isCapacityViolation(error)) return false;
    throw error;
  }
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
