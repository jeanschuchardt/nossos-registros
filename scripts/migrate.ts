import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Defina DATABASE_URL_UNPOOLED ou DATABASE_URL.");
}

const migrationsDirectory = join(process.cwd(), "db", "migrations");
const client = new pg.Client({ connectionString, application_name: "nossos-registros-migrations" });

async function migrate(): Promise<void> {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE name = $1",
      [file]
    );

    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`A migration aplicada ${file} foi alterada.`);
      }
      console.log(`OK: ${file} já aplicada.`);
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [file, checksum]
      );
      await client.query("COMMIT");
      console.log(`OK: ${file} aplicada.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

migrate()
  .catch((error: unknown) => {
    console.error("ERRO: migration falhou:", error instanceof Error ? error.message : "erro desconhecido");
    process.exitCode = 1;
  })
  .finally(() => client.end());
