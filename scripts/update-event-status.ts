import pg from "pg";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]?.replace(/^--/, "");
  const value = process.argv[index + 1];
  if (key && value) args.set(key, value);
}

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const slug = args.get("slug");
const status = args.get("status");
const allowedStatuses = new Set(["draft", "active", "closed", "archived"]);

if (!connectionString) throw new Error("Defina DATABASE_URL_UNPOOLED ou DATABASE_URL.");
if (!slug) throw new Error("Use --slug <slug>.");
if (!status || !allowedStatuses.has(status)) {
  throw new Error("Use --status draft|active|closed|archived.");
}

const client = new pg.Client({ connectionString, application_name: "nossos-registros-update-event" });

async function updateEvent(): Promise<void> {
  await client.connect();
  const result = await client.query<{ slug: string; status: string }>(`
    UPDATE events
    SET status = $2
    WHERE slug = $1
    RETURNING slug, status
  `, [slug, status]);
  const event = result.rows[0];
  if (!event) throw new Error("Evento não encontrado.");
  console.log(`OK: evento ${event.slug} atualizado para ${event.status}.`);
}

updateEvent()
  .catch((error: unknown) => {
    console.error("ERRO: não foi possível atualizar o evento:", error instanceof Error ? error.message : "erro desconhecido");
    process.exitCode = 1;
  })
  .finally(() => client.end());
