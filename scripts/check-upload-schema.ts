import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Defina DATABASE_URL_UNPOOLED ou DATABASE_URL.");

const client = new pg.Client({ connectionString, application_name: "nossos-registros-upload-schema-check" });

async function checkUploadSchema(): Promise<void> {
  await client.connect();
  await client.query("BEGIN");
  try {
    const eventResult = await client.query<{ id: string; capacity_bytes: string }>(
      "SELECT id, capacity_bytes FROM events WHERE slug = $1",
      ["casamento-fran-jean"]
    );
    const event = eventResult.rows[0];
    if (!event) throw new Error("Evento de teste não encontrado.");

    await client.query(`
      INSERT INTO uploads (event_id, idempotency_key, original_filename, mime_type, size_bytes, status)
      VALUES ($1, $2, 'teste.jpg', 'image/jpeg', 1024, 'creating_session')
    `, [event.id, randomUUID()]);

    await client.query("SAVEPOINT capacity_check");
    let capacityWasRejected = false;
    try {
      await client.query(`
        INSERT INTO uploads (event_id, idempotency_key, original_filename, mime_type, size_bytes, status)
        VALUES ($1, $2, 'grande.mp4', 'video/mp4', $3, 'creating_session')
      `, [event.id, randomUUID(), BigInt(event.capacity_bytes) + 1n]);
    } catch {
      capacityWasRejected = true;
      await client.query("ROLLBACK TO SAVEPOINT capacity_check");
    }
    if (!capacityWasRejected) throw new Error("O banco aceitou um upload acima da capacidade.");

    console.log("OK: creating_session aceito e excesso de capacidade rejeitado.");
  } finally {
    await client.query("ROLLBACK");
  }
}

checkUploadSchema()
  .catch((error: unknown) => {
    console.error("ERRO: verificação de uploads falhou:", error instanceof Error ? error.message : "erro desconhecido");
    process.exitCode = 1;
  })
  .finally(() => client.end());
