import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations, migrationFiles } from "../test/pglite";

// Cada teste sobe um Postgres em WASM; sob carga isso passa dos 5 s padrão.
describe("migrations", { timeout: 30_000 }, () => {
  it("0004 gera tokens distintos para eventos já existentes", async () => {
    const db = new PGlite();
    const files = migrationFiles();
    const index = files.indexOf("0004_event_access_token_and_dates.sql");
    await applyMigrations(db, files.slice(0, index));
    await db.exec(`
      INSERT INTO events (slug, name, drive_folder_id) VALUES ('evento-a', 'A', 'pasta-a'), ('evento-b', 'B', 'pasta-b');
    `);
    await applyMigrations(db, files.slice(index));

    const { rows } = await db.query<{ access_token: string }>("SELECT access_token FROM events");
    expect(rows).toHaveLength(2);
    expect(rows[0].access_token).toMatch(/^[a-f0-9]{20}$/);
    expect(rows[0].access_token).not.toBe(rows[1].access_token);
  });

  it("permite mais de cinco eventos ativos", async () => {
    const db = new PGlite();
    await applyMigrations(db);
    for (let index = 0; index < 7; index += 1) {
      await db.query("INSERT INTO events (slug, name, status, drive_folder_id) VALUES ($1, 'E', 'active', $2)", [`evento-${index}`, `pasta-${index}`]);
    }
    const { rows } = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM events WHERE status = 'active'");
    expect(rows[0].count).toBe(7);
  });
});
