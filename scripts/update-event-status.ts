import { formatSaoPaulo, uploadWindowFor } from "../lib/event-window";
import { databaseClient, parseArgs, run, UsageError } from "./lib/cli";

const USAGE = `Uso:
  npm run db:update-event -- --slug <slug> [--status draft|active|closed|archived] [--event-date AAAA-MM-DD]
    --event-date recalcula a janela de envio (24 h antes até 7 dias depois).`;

const allowedStatuses = new Set(["draft", "active", "closed", "archived"]);
const args = parseArgs();

async function updateEvent(): Promise<void> {
  const slug = args.get("slug");
  const status = args.get("status");
  const eventDate = args.get("event-date");
  if (!slug || (!status && !eventDate)) throw new UsageError(USAGE);
  if (status && !allowedStatuses.has(status)) throw new UsageError(USAGE);
  const window = eventDate ? uploadWindowFor(eventDate) : null;

  const client = databaseClient("nossos-registros-update-event");
  await client.connect();
  try {
    const result = await client.query<{ slug: string; status: string; upload_starts_at: Date | null; upload_ends_at: Date | null }>(`
      UPDATE events
      SET status = COALESCE($2, status),
        event_date = COALESCE($3::date, event_date),
        upload_starts_at = CASE WHEN $3::date IS NULL THEN upload_starts_at ELSE $4 END,
        upload_ends_at = CASE WHEN $3::date IS NULL THEN upload_ends_at ELSE $5 END
      WHERE slug = $1
      RETURNING slug, status, upload_starts_at, upload_ends_at
    `, [slug, status ?? null, window?.eventDate ?? null, window?.startsAt ?? null, window?.endsAt ?? null]);
    const event = result.rows[0];
    if (!event) throw new UsageError("evento não encontrado.");
    const range = event.upload_starts_at && event.upload_ends_at
      ? `; envios de ${formatSaoPaulo(event.upload_starts_at)} até ${formatSaoPaulo(event.upload_ends_at)}`
      : "; sem janela de envio definida";
    console.log(`OK: evento ${event.slug} está ${event.status}${range}.`);
  } finally {
    await client.end();
  }
}

void run(updateEvent, "não foi possível atualizar o evento");
