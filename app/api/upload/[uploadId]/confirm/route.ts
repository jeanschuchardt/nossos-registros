import { NextRequest } from "next/server";
import { hasSameOrigin, json } from "@/lib/api";
import { verifyDriveFile } from "@/lib/google-drive";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isValidUploadToken } from "@/lib/session-crypto";
import { completeUpload, getUploadForConfirmation, isUploadId, markAwaitingConfirmation } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  if (!hasSameOrigin(request)) return json({ error: "Origem da requisição inválida." }, 403);
  const { uploadId } = await params;
  if (!isUploadId(uploadId) || !isValidUploadToken(request.headers.get("x-upload-token"), uploadId)) {
    return json({ error: "Upload não encontrado." }, 404);
  }
  if (!(await consumeRateLimit("confirm", request))) return json({ error: "Muitas tentativas. Aguarde um minuto." }, 429);

  let body: { driveFileId?: unknown } = {};
  try { body = await request.json(); } catch { /* A reconciliação pode não ter um ID final. */ }

  const upload = await getUploadForConfirmation(uploadId);
  if (!upload) return json({ error: "Upload não encontrado." }, 404);
  if (upload.status === "completed" && upload.driveFileId) {
    return json({ completed: true, driveFileId: upload.driveFileId });
  }

  if (!(await markAwaitingConfirmation(upload.id))) {
    console.warn("Upload não pôde voltar a reservar capacidade", { eventId: upload.eventId, uploadId: upload.id, status: upload.status });
    return json({ error: "Este evento atingiu o limite de armazenamento." }, 409);
  }
  try {
    const requestedFileId = typeof body.driveFileId === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(body.driveFileId)
      ? body.driveFileId
      : undefined;
    const file = await verifyDriveFile(requestedFileId, {
      driveFilename: upload.driveFilename,
      driveFolderId: upload.driveFolderId,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes
    });
    await completeUpload(upload.id, file.id);
    console.info("Upload confirmado", { eventId: upload.eventId, uploadId: upload.id, driveFileId: file.id });
    return json({ completed: true, driveFileId: file.id });
  } catch (error) {
    console.warn("Upload aguardando confirmação", { eventId: upload.eventId, uploadId: upload.id, error: error instanceof Error ? error.message : "Erro desconhecido" });
    return json({ error: "O arquivo ainda não pôde ser confirmado. Tente novamente." }, 409);
  }
}
