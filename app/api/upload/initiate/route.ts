import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createResumableSession } from "@/lib/google-drive";
import { allowSessionCreation } from "@/lib/rate-limit";
import { validateFileMetadata } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 15;

function tokenMatches(candidate: string): boolean {
  const expected = process.env.EVENT_TOKEN;
  if (!expected || !candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-event-token") ?? "";
  if (!tokenMatches(token)) return NextResponse.json({ error: "Acesso inválido." }, { status: 403 });

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
  const validated = validateFileMetadata(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  console.info("Iniciando sessão de upload", { mimeType: validated.value.mimeType, size: validated.value.size });
  try {
    // Drive binds CORS responses for the resumable session to this Origin.
    const session = await createResumableSession(validated.value, browserOrigin);
    console.info("Sessão de upload criada", { mimeType: validated.value.mimeType, size: validated.value.size });
    return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha ao criar sessão no Google Drive", error instanceof Error ? error.message : "Erro desconhecido");
    return NextResponse.json({ error: "Não foi possível preparar o upload. Tente novamente." }, { status: 502 });
  }
}
