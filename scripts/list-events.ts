import { formatSaoPaulo } from "../lib/event-window";
import { databaseClient, eventUrl, parseArgs, run } from "./lib/cli";

// Uso: npm run db:list-events [-- --all]   (padrão: só eventos active)
const args = parseArgs();

async function listEvents(): Promise<void> {
  const client = databaseClient("nossos-registros-list-events");
  await client.connect();
  try {
    const result = await client.query<{
      slug: string; name: string; status: string; access_token: string;
      upload_starts_at: Date | null; upload_ends_at: Date | null;
      used_bytes: string; capacity_bytes: string;
    }>(`
      SELECT e.slug, e.name, e.status, e.access_token, e.upload_starts_at, e.upload_ends_at,
        u.used_bytes, e.capacity_bytes
      FROM events e
      JOIN event_storage_usage u ON u.event_id = e.id
      WHERE $1 OR e.status = 'active'
      ORDER BY e.status, e.created_at
    `, [args.has("all")]);

    if (!result.rowCount) {
      console.log(args.has("all") ? "Nenhum evento cadastrado." : "Nenhum evento ativo. Use --all para ver todos.");
      return;
    }
    for (const event of result.rows) {
      const usedGb = (Number(event.used_bytes) / 1024 ** 3).toFixed(1);
      const capacityGb = Math.round(Number(event.capacity_bytes) / 1024 ** 3);
      const window = event.upload_starts_at || event.upload_ends_at
        ? `${event.upload_starts_at ? formatSaoPaulo(event.upload_starts_at) : "—"} até ${event.upload_ends_at ? formatSaoPaulo(event.upload_ends_at) : "—"}`
        : "sem prazo definido";
      console.log(`\n${event.name} (${event.slug}) — ${event.status}`);
      console.log(`  Link:    ${eventUrl(event.slug, event.access_token)}`);
      console.log(`  Envios:  ${window}`);
      console.log(`  Uso:     ${usedGb} de ${capacityGb} GB`);
    }
  } finally {
    await client.end();
  }
}

void run(listEvents, "não foi possível listar os eventos");
