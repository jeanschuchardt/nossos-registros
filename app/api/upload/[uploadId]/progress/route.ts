import { NextRequest, NextResponse } from "next/server";
import { recordUploadProgress } from "@/lib/uploads";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const browserOrigin = request.headers.get("origin") ?? "";
  if (!browserOrigin || browserOrigin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Origem da requisição inválida." }, { status: 403 });
  }
  const eventSlug = request.headers.get("x-event-slug") ?? "";
  const { uploadId } = await params;
  let body: { confirmedBytes?: unknown; state?: unknown } = {};
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const confirmedBytes = body.confirmedBytes;
  const state = body.state;
  if (!Number.isSafeInteger(confirmedBytes) || (confirmedBytes as number) < 0
    || (state !== "uploading" && state !== "retry_pending" && state !== "expired")) {
    return NextResponse.json({ error: "Progresso inválido." }, { status: 400 });
  }
  const updated = await recordUploadProgress(
    uploadId,
    eventSlug,
    confirmedBytes as number,
    state as "uploading" | "retry_pending" | "expired"
  );
  if (!updated) return NextResponse.json({ error: "Upload não encontrado ou estado inválido." }, { status: 409 });
  return NextResponse.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
}
