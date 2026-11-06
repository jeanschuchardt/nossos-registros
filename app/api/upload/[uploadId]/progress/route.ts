import { NextRequest } from "next/server";
import { hasSameOrigin, json } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isValidUploadToken } from "@/lib/session-crypto";
import { isUploadId, recordUploadProgress } from "@/lib/uploads";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  if (!hasSameOrigin(request)) return json({ error: "Origem da requisição inválida." }, 403);
  const { uploadId } = await params;
  if (!isUploadId(uploadId) || !isValidUploadToken(request.headers.get("x-upload-token"), uploadId)) {
    return json({ error: "Upload não encontrado." }, 404);
  }
  if (!(await consumeRateLimit("progress", request))) return json({ error: "Muitas tentativas." }, 429);

  let body: { confirmedBytes?: unknown; state?: unknown } = {};
  try { body = await request.json(); } catch {
    return json({ error: "JSON inválido." }, 400);
  }
  const { confirmedBytes, state } = body;
  if (!Number.isSafeInteger(confirmedBytes) || (confirmedBytes as number) < 0
    || (state !== "uploading" && state !== "retry_pending" && state !== "expired")) {
    return json({ error: "Progresso inválido." }, 400);
  }
  const updated = await recordUploadProgress(uploadId, confirmedBytes as number, state);
  if (!updated) return json({ error: "Upload não encontrado ou estado inválido." }, 409);
  return json({ updated: true });
}
