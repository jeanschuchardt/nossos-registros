import { notFound } from "next/navigation";
import { UploadArea } from "@/components/UploadArea";
import { eventAvailability, findEventBySlug } from "@/lib/events";

export const dynamic = "force-dynamic";

const unavailableMessages = {
  draft: ["Evento em preparação", "O envio de arquivos ainda não foi liberado."],
  closed: ["Envios encerrados", "Este evento não está mais recebendo arquivos."],
  not_started: ["Envios ainda não iniciados", "Volte a este link quando o período de envio começar."],
  ended: ["Período de envio encerrado", "O prazo para compartilhar arquivos terminou."]
} as const;

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await findEventBySlug(slug);
  if (!event) notFound();

  const availability = eventAvailability(event);
  const message = availability === "available" ? null : unavailableMessages[availability];

  return (
    <main className="shell">
      <section className="card">
        <header className="hero">
          <p className="eyebrow">{event.name}</p>
          <h1>Compartilhe seus registros<br />deste momento</h1>
          <p>Adicione aqui as fotos e vídeos que você registrou durante esse dia.</p>
        </header>
        {availability === "available" ? (
          <UploadArea eventSlug={event.slug} maxFileSizeGb={event.maxFileSizeBytes / 1024 ** 3} />
        ) : (
          <div className="invalid"><h2>{message?.[0]}</h2><p>{message?.[1]}</p></div>
        )}
      </section>
    </main>
  );
}
