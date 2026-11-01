import pg from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Defina DATABASE_URL_UNPOOLED ou DATABASE_URL.");
}

const client = new pg.Client({ connectionString, application_name: "nossos-registros-check" });

async function checkDatabase(): Promise<void> {
  await client.connect();

  const relations = await client.query<{ name: string; kind: string }>(`
    SELECT c.relname AS name,
      CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' ELSE c.relkind::text END AS kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('events', 'uploads', 'event_storage_usage', 'schema_migrations')
    ORDER BY c.relname
  `);

  const expected = new Set(["events", "uploads", "event_storage_usage", "schema_migrations"]);
  for (const relation of relations.rows) expected.delete(relation.name);
  if (expected.size) throw new Error(`Estruturas ausentes: ${[...expected].join(", ")}.`);

  const migrations = await client.query<{ name: string }>(
    "SELECT name FROM schema_migrations ORDER BY name"
  );
  const events = await client.query<{ slug: string; status: string; capacity_gb: string }>(`
    SELECT slug, status, (capacity_bytes / 1024 / 1024 / 1024)::text AS capacity_gb
    FROM events
    ORDER BY created_at
  `);

  console.log("OK: estruturas:", relations.rows.map(({ name, kind }) => `${name} (${kind})`).join(", "));
  console.log("OK: migrations:", migrations.rows.map(({ name }) => name).join(", "));
  console.log("OK: eventos:", events.rows.map(({ slug, status, capacity_gb }) => `${slug} (${status}, ${capacity_gb} GB)`).join(", ") || "nenhum");
}

checkDatabase()
  .catch((error: unknown) => {
    console.error("ERRO: verificação falhou:", error instanceof Error ? error.message : "erro desconhecido");
    process.exitCode = 1;
  })
  .finally(() => client.end());
