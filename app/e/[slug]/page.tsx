import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { UploadArea } from "@/components/UploadArea";
import { eventAvailability, findEventWithAccess } from "@/lib/events";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ k?: string | string[] }>;
};

const unavailableMessages = {
  draft: ["Evento em preparação", "O envio de arquivos ainda não foi liberado."],
  closed: ["Envios encerrados", "Este evento não está mais recebendo arquivos."],
  not_started: ["Envios ainda não iniciados", "Volte a este link quando o período de envio começar."],
  ended: ["Período de envio encerrado", "O prazo para compartilhar arquivos terminou."]
} as const;

// generateMetadata e a página compartilham a mesma consulta por requisição.
const loadEvent = cache(async (slug: string, key: string | undefined) => findEventWithAccess(slug, key));

async function resolve({ params, searchParams }: PageProps) {
  const [{ slug }, { k }] = await Promise.all([params, searchParams]);
  const key = Array.isArray(k) ? k[0] : k;
  return { key: key ?? "", event: await loadEvent(slug, key) };
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { event } = await resolve(props);
  if (!event) return { title: "Link inválido" };
  return {
    title: `${event.name} — Compartilhe seus registros`,
    description: `Envie as fotos e vídeos que você registrou em ${event.name}.`
  };
}

export default async function EventPage(props: PageProps) {
  const { event, key } = await resolve(props);
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
          <UploadArea eventSlug={event.slug} eventKey={key} maxFileSizeBytes={event.maxFileSizeBytes} />
        ) : (
          <div className="invalid"><h2>{message?.[0]}</h2><p>{message?.[1]}</p></div>
        )}
      </section>
    </main>
  );
}
