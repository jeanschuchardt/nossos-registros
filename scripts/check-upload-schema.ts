import { randomUUID } from "node:crypto";
import { databaseClient, run } from "./lib/cli";

// Tudo roda numa transação que sempre é revertida: funciona em banco limpo e
// não deixa rastro em produção.
async function checkUploadSchema(): Promise<void> {
  const client = databaseClient("nossos-registros-upload-schema-check");
  await client.connect();
  await client.query("BEGIN");
  try {
    const createEvent = async (suffix: string) => {
      const result = await client.query<{ id: string; capacity_bytes: string; access_token: string }>(`
        INSERT INTO events (slug, name, status, drive_folder_id, capacity_bytes, max_file_size_bytes)
        VALUES ($1, 'Verificação', 'active', $2, 1048576, 1048576)
        RETURNING id, capacity_bytes, access_token
      `, [`schema-check-${suffix}-${randomUUID().slice(0, 8)}`, `schema-check-${randomUUID()}`]);
      return result.rows[0];
    };
    const event = await createEvent("a");
    const otherEvent = await createEvent("b");
    if (!event.access_token || event.access_token === otherEvent.access_token) {
      throw new Error("Os eventos não receberam tokens de acesso distintos.");
    }

    // Mesma chave de idempotência em eventos diferentes não colide.
    const sharedKey = randomUUID();
    for (const target of [event, otherEvent]) {
      await client.query(`
        INSERT INTO uploads (event_id, idempotency_key, original_filename, mime_type, size_bytes, status)
        VALUES ($1, $2, 'teste.jpg', 'image/jpeg', 1024, 'creating_session')
      `, [target.id, sharedKey]);
    }

    await client.query("SAVEPOINT capacity_check");
    let capacityWasRejected = false;
    try {
      await client.query(`
        INSERT INTO uploads (event_id, idempotency_key, original_filename, mime_type, size_bytes, status)
        VALUES ($1, $2, 'grande.mp4', 'video/mp4', $3, 'creating_session')
      `, [event.id, randomUUID(), event.capacity_bytes]);
    } catch {
      capacityWasRejected = true;
      await client.query("ROLLBACK TO SAVEPOINT capacity_check");
    }
    if (!capacityWasRejected) throw new Error("O banco aceitou um upload acima da capacidade.");

    // Upload expirado libera a capacidade.
    await client.query("UPDATE uploads SET status = 'expired' WHERE event_id = $1", [event.id]);
    await client.query(`
      INSERT INTO uploads (event_id, idempotency_key, original_filename, mime_type, size_bytes, status)
      VALUES ($1, $2, 'cheio.mp4', 'video/mp4', $3, 'creating_session')
    `, [event.id, randomUUID(), event.capacity_bytes]);

    const limiterKey = `schema-check-${randomUUID()}`;
    const first = await client.query<{ allowed: boolean }>("SELECT consume_rate_limit($1, 1, 60) AS allowed", [limiterKey]);
    const second = await client.query<{ allowed: boolean }>("SELECT consume_rate_limit($1, 1, 60) AS allowed", [limiterKey]);
    if (!first.rows[0]?.allowed || second.rows[0]?.allowed) {
      throw new Error("O rate limit persistente não bloqueou a segunda requisição.");
    }

    console.log("OK: tokens por evento, isolamento, capacidade, liberação por expiração e rate limit validados.");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

void run(checkUploadSchema, "verificação de uploads falhou");
