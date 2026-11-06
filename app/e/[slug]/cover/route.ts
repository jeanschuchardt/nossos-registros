import { NextRequest, NextResponse } from "next/server";
import { readQuery } from "@/lib/db";
import { findEventWithAccess } from "@/lib/events";

export const runtime = "nodejs";

// A capa só abre com o token do evento, como a própria página. O parâmetro `v`
// muda a cada troca de capa, então o navegador pode guardar a imagem por muito tempo.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await findEventWithAccess(slug, request.nextUrl.searchParams.get("k"));
  if (!event) return new NextResponse(null, { status: 404 });

  const result = await readQuery<{ image: Buffer; mime_type: string }>(
    "SELECT image, mime_type FROM event_covers WHERE event_id = $1",
    [event.id]
  );
  const cover = result.rows[0];
  if (!cover) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(cover.image), {
    headers: {
      "Content-Type": cover.mime_type,
      "Content-Length": String(cover.image.length),
      // private: a URL carrega o token do evento e não deve ficar em caches compartilhados.
      "Cache-Control": "private, max-age=31536000, immutable"
    }
  });
}
