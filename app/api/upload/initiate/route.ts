import { NextRequest } from "next/server";
import { hasSameOrigin, json } from "@/lib/api";
import { createResumableSession } from "@/lib/google-drive";
import { eventAvailability, findEventWithAccess } from "@/lib/events";
import {
  EventCapacityExceededError,
  isUploadId,
  markUploadPreparationFailed,
  prepareUpload,
  saveUploadSession,
  UploadConflictError,
  UploadPreparationPendingError
} from "@/lib/uploads";
import { clientKeyHash, consumeRateLimit } from "@/lib/rate-limit";
import { uploadToken } from "@/lib/session-crypto";
import { validateFileMetadata } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return json({ error: "Origem da requisição inválida." }, 403);
  if (!(await consumeRateLimit("initiate", request))) {
    return json({ error: "Muitas tentativas. Aguarde um minuto." }, 429);
  }

  const event = await findEventWithAccess(
    request.headers.get("x-event-slug") ?? "",
    request.headers.get("x-event-key")
  );
  if (!event) return json({ error: "Link do evento inválido." }, 404);
  if (eventAvailability(event) !== "available") {
    return json({ error: "Este evento não está recebendo arquivos." }, 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return json({ error: "JSON inválido." }, 400);
  }
  const validated = validateFileMetadata(body, event.maxFileSizeBytes);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const idempotencyKey = String((body as { idempotencyKey?: unknown }).idempotencyKey ?? "");
  if (!isUploadId(idempotencyKey)) return json({ error: "Identificador do upload inválido." }, 400);

  let prepared;
  try {
    prepared = await prepareUpload(event, validated.value, idempotencyKey, clientKeyHash(request));
  } catch (error) {
    if (error instanceof UploadPreparationPendingError) return json({ error: error.message, retryable: true }, 409);
    if (error instanceof EventCapacityExceededError) return json({ error: error.message, capacityExceeded: true }, 409);
    if (error instanceof UploadConflictError) return json({ error: error.message }, 409);
    console.error("Falha ao registrar upload", { eventId: event.id, error: error instanceof Error ? error.message : "Erro desconhecido" });
    return json({ error: "Não foi possível registrar o upload." }, 500);
  }

  const token = uploadToken(prepared.uploadId);
  if (prepared.kind === "completed") return json({ uploadId: prepared.uploadId, uploadToken: token, completed: true });
  if (prepared.kind === "confirm") return json({ uploadId: prepared.uploadId, uploadToken: token, awaitingConfirmation: true });
  if (prepared.kind === "resume") {
    return json({ uploadId: prepared.uploadId, uploadToken: token, sessionUrl: prepared.sessionUrl, uploadName: prepared.uploadName });
  }

  console.info("Iniciando sessão de upload", { eventId: event.id, uploadId: prepared.uploadId, mimeType: validated.value.mimeType, size: validated.value.size });
  try {
    const session = await createResumableSession(validated.value, request.headers.get("origin")!, event.driveFolderId);
    await saveUploadSession(prepared.uploadId, session.sessionUrl, session.uploadName);
    console.info("Sessão de upload criada", { eventId: event.id, uploadId: prepared.uploadId });
    return json({ ...session, uploadId: prepared.uploadId, uploadToken: token });
  } catch (error) {
    await markUploadPreparationFailed(prepared.uploadId, "drive_session_creation_failed");
    console.error("Falha ao criar sessão no Google Drive", { eventId: event.id, uploadId: prepared.uploadId, error: error instanceof Error ? error.message : "Erro desconhecido" });
    return json({ error: "Não foi possível preparar o upload. Tente novamente." }, 502);
  }
}
