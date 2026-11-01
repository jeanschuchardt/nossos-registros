import pg from "pg";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]?.replace(/^--/, "");
  const value = process.argv[index + 1];
  if (key && value) args.set(key, value);
}

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
const slug = args.get("slug");
const name = args.get("name");

if (!connectionString) throw new Error("Defina DATABASE_URL_UNPOOLED ou DATABASE_URL.");
if (!driveFolderId) throw new Error("Defina GOOGLE_DRIVE_FOLDER_ID.");
if (!slug || !name) throw new Error("Use --slug <slug> --name <nome>.");

const client = new pg.Client({ connectionString, application_name: "nossos-registros-create-event" });

async function createEvent(): Promise<void> {
  await client.connect();
  const result = await client.query<{ id: string; slug: string; status: string }>(`
    INSERT INTO events (slug, name, status, drive_folder_id)
    VALUES ($1, $2, 'draft', $3)
    RETURNING id, slug, status
  `, [slug, name, driveFolderId]);
  const event = result.rows[0];
  console.log(`OK: evento ${event.slug} criado como ${event.status} (${event.id}).`);
}

createEvent()
  .catch((error: unknown) => {
    console.error("ERRO: não foi possível criar o evento:", error instanceof Error ? error.message : "erro desconhecido");
    process.exitCode = 1;
  })
  .finally(() => client.end());
