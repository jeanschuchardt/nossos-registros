import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = join(__dirname, "..", "db", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")).sort();
}

export async function applyMigrations(db: PGlite, files = migrationFiles()): Promise<void> {
  for (const file of files) await db.exec(readFileSync(join(migrationsDirectory, file), "utf8"));
}

/** Banco Postgres em memória com a mesma interface mínima do pg.Pool usada pelo app. */
export async function createTestDatabase() {
  const db = new PGlite();
  await applyMigrations(db);
  const query = async (text: string, values: unknown[] = []) => {
    const result = await db.query(text, values as never[]);
    return { rows: result.rows as never[], rowCount: result.affectedRows || result.rows.length };
  };
  return {
    db,
    pool: { query, connect: async () => ({ query, release: () => undefined }) },
    query
  };
}
