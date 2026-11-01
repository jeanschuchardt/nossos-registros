import { NextRequest, NextResponse } from "next/server";
import { verifyDriveFile } from "@/lib/google-drive";
import { completeUpload, getUploadForConfirmation, markAwaitingConfirmation } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const browserOrigin = request.headers.get("origin") ?? "";
  if (!browserOrigin || browserOrigin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Origem da requisição inválida." }, { status: 403 });
  }
  const eventSlug = request.headers.get("x-event-slug") ?? "";
  const { uploadId } = await params;
  let body: { driveFileId?: unknown } = {};
  try { body = await request.json(); } catch { /* A reconciliação pode não ter um ID final. */ }

  const upload = await getUploadForConfirmation(uploadId, eventSlug);
  if (!upload) return NextResponse.json({ error: "Upload não encontrado." }, { status: 404 });
  if (upload.status === "completed" && upload.driveFileId) {
    return NextResponse.json({ completed: true, driveFileId: upload.driveFileId });
  }

  await markAwaitingConfirmation(upload.id);
  try {
    const requestedFileId = typeof body.driveFileId === "string" ? body.driveFileId : undefined;
    const file = await verifyDriveFile(requestedFileId, {
      driveFilename: upload.driveFilename,
      driveFolderId: upload.driveFolderId,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes
    });
    await completeUpload(upload.id, file.id);
    console.info("Upload confirmado", { eventId: upload.eventId, uploadId: upload.id, driveFileId: file.id });
    return NextResponse.json({ completed: true, driveFileId: file.id });
  } catch (error) {
    console.warn("Upload aguardando confirmação", { eventId: upload.eventId, uploadId: upload.id, error: error instanceof Error ? error.message : "Erro desconhecido" });
    return NextResponse.json({ error: "O arquivo ainda não pôde ser confirmado. Tente novamente." }, { status: 409 });
  }
}
