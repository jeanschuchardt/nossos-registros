import { NextRequest, NextResponse } from "next/server";
import { createResumableSession } from "@/lib/google-drive";
import { eventAvailability, findEventBySlug } from "@/lib/events";
import {
  markUploadPreparationFailed,
  prepareUpload,
  saveUploadSession,
  UploadConflictError,
  UploadPreparationPendingError
} from "@/lib/uploads";
import { allowSessionCreation } from "@/lib/rate-limit";
import { validateFileMetadata } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const eventSlug = request.headers.get("x-event-slug") ?? "";
  if (!eventSlug) return NextResponse.json({ error: "Evento inválido." }, { status: 400 });

  const event = await findEventBySlug(eventSlug);
  if (!event) return NextResponse.json({ error: "Evento não encontrado." }, { status: 404 });
  if (eventAvailability(event) !== "available") {
    return NextResponse.json({ error: "Este evento não está recebendo arquivos." }, { status: 403 });
  }

  const browserOrigin = request.headers.get("origin") ?? "";
  if (!browserOrigin || browserOrigin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Origem da requisição inválida." }, { status: 403 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowSessionCreation(ip)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const validated = validateFileMetadata(body, event.maxFileSizeBytes);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const idempotencyKey = typeof body === "object" && body && "idempotencyKey" in body
    ? String((body as { idempotencyKey?: unknown }).idempotencyKey ?? "")
    : "";
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    return NextResponse.json({ error: "Identificador do upload inválido." }, { status: 400 });
  }

  let prepared;
  try {
    prepared = await prepareUpload(event, validated.value, idempotencyKey);
  } catch (error) {
    if (error instanceof UploadPreparationPendingError) {
      return NextResponse.json({ error: error.message, retryable: true }, { status: 409 });
    }
    if (error instanceof UploadConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Falha ao registrar upload", { eventId: event.id, error: error instanceof Error ? error.message : "Erro desconhecido" });
    return NextResponse.json({ error: "Não foi possível registrar o upload." }, { status: 409 });
  }

  if (prepared.kind === "completed") {
    return NextResponse.json({ uploadId: prepared.uploadId, completed: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (prepared.kind === "confirm") {
    return NextResponse.json({ uploadId: prepared.uploadId, awaitingConfirmation: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (prepared.kind === "resume") {
    return NextResponse.json({ uploadId: prepared.uploadId, sessionUrl: prepared.sessionUrl, uploadName: prepared.uploadName }, { headers: { "Cache-Control": "no-store" } });
  }

  console.info("Iniciando sessão de upload", { eventId: event.id, uploadId: prepared.uploadId, mimeType: validated.value.mimeType, size: validated.value.size });
  try {
    const session = await createResumableSession(validated.value, browserOrigin, event.driveFolderId);
    await saveUploadSession(prepared.uploadId, session.sessionUrl, session.uploadName);
    console.info("Sessão de upload criada", { eventId: event.id, uploadId: prepared.uploadId });
    return NextResponse.json({ ...session, uploadId: prepared.uploadId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await markUploadPreparationFailed(prepared.uploadId, "drive_session_creation_failed");
    console.error("Falha ao criar sessão no Google Drive", { eventId: event.id, uploadId: prepared.uploadId, error: error instanceof Error ? error.message : "Erro desconhecido" });
    return NextResponse.json({ error: "Não foi possível preparar o upload. Tente novamente." }, { status: 502 });
  }
}
