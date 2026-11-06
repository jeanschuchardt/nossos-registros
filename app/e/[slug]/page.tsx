import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EventCover } from "@/components/EventCover";
import { UploadArea } from "@/components/UploadArea";
import { coverUrl, formatEventDate, type EventDisplay } from "@/lib/event-display";
import { eventAvailability, findEventWithAccess } from "@/lib/events";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ k?: string | string[] }>;
};

const unavailableMessages = {
  draft: ["Ainda estamos preparando tudo", "O envio de fotos e vídeos ainda não foi liberado. Volte mais perto do evento."],
  closed: ["Os envios foram encerrados", "Este evento não está mais recebendo fotos e vídeos. Obrigado por fazer parte."],
  not_started: ["Os envios abrem em breve", "Volte a este link no dia anterior ao evento para compartilhar o que registrar."],
  ended: ["O prazo de envio terminou", "Este evento não está mais recebendo fotos e vídeos. Obrigado por fazer parte."]
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

  const display: EventDisplay = {
    slug: event.slug,
    accessKey: key,
    name: event.name,
    dateLabel: formatEventDate(event.eventDate),
    coverUrl: coverUrl(event.slug, key, event.coverVersion),
    maxFileSizeBytes: event.maxFileSizeBytes
  };
  const availability = eventAvailability(event);

  if (availability === "available") return <UploadArea event={display} />;

  const [title, text] = unavailableMessages[availability];
  return (
    <main className="event">
      <EventCover name={display.name} dateLabel={display.dateLabel} coverUrl={display.coverUrl} />
      <section className="panel panel-message">
        <h2>{title}</h2>
        <p>{text}</p>
      </section>
    </main>
  );
}
