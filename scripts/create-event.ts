import { randomBytes } from "node:crypto";
import { formatSaoPaulo, uploadWindowFor } from "../lib/event-window";
import { databaseClient, eventUrl, parseArgs, run, UsageError } from "./lib/cli";
import { assertDriveFolder, createDriveFolder, googleAccessToken } from "./lib/google";

const USAGE = `Uso:
  npm run db:create-event -- --slug <slug> --name "<nome>" --event-date AAAA-MM-DD
    [--folder-id <id>]          pasta já existente (padrão: cria uma pasta nova pelo app)
    [--parent-folder-id <id>]   onde criar a pasta (padrão: GOOGLE_DRIVE_PARENT_FOLDER_ID ou raiz)
    [--capacity-gb 100]
    [--active]                  já cria como active (padrão: draft)`;

const args = parseArgs();

async function createEvent(): Promise<void> {
  const slug = args.get("slug");
  const name = args.get("name");
  const eventDate = args.get("event-date");
  if (!slug || !name || !eventDate) throw new UsageError(USAGE);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 100) {
    throw new UsageError("o slug deve ter 3–100 caracteres: letras minúsculas, números e hífens.");
  }
  const window = uploadWindowFor(eventDate);
  const capacityGb = Number(args.get("capacity-gb") ?? "100");
  if (!Number.isFinite(capacityGb) || capacityGb <= 0) throw new UsageError("--capacity-gb deve ser positivo.");
  const status = args.has("active") ? "active" : "draft";

  const client = databaseClient("nossos-registros-create-event");
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM events WHERE slug = $1", [slug]);
    if (existing.rowCount) throw new UsageError(`já existe um evento com o slug ${slug}.`);

    // A pasta é validada (ou criada) antes do INSERT: nenhum evento fica apontando para pasta inacessível.
    const accessToken = await googleAccessToken();
    let folderId = args.get("folder-id");
    if (folderId) {
      const folderName = await assertDriveFolder(accessToken, folderId);
      const reused = await client.query("SELECT slug FROM events WHERE drive_folder_id = $1", [folderId]);
      if (reused.rowCount) throw new UsageError(`a pasta já pertence ao evento ${reused.rows[0].slug}.`);
      console.log(`OK: pasta existente "${folderName}" validada.`);
    } else {
      const parentId = args.get("parent-folder-id") ?? process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
      folderId = await createDriveFolder(accessToken, `${eventDate} — ${name}`, parentId);
      console.log(`OK: pasta "${eventDate} — ${name}" criada no Drive (${folderId}).`);
    }

    const result = await client.query<{ id: string; access_token: string }>(`
      INSERT INTO events (
        slug, name, status, drive_folder_id, access_token, event_date,
        upload_starts_at, upload_ends_at, capacity_bytes, max_file_size_bytes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, LEAST($9, 10737418240))
      RETURNING id, access_token
    `, [
      slug, name, status, folderId, randomBytes(15).toString("base64url"), window.eventDate,
      window.startsAt, window.endsAt, Math.round(capacityGb * 1024 ** 3)
    ]);
    const event = result.rows[0];
    console.log(`OK: evento ${slug} criado como ${status} (${event.id}).`);
    console.log(`    Envios: ${formatSaoPaulo(window.startsAt)} até ${formatSaoPaulo(window.endsAt)} (horário de Brasília).`);
    console.log(`    Link:   ${eventUrl(slug, event.access_token)}`);
    if (status === "draft") console.log(`    Ativar: npm run db:update-event -- --slug ${slug} --status active`);
    console.log(`    QR:     npm run qr -- --slug ${slug}`);
  } finally {
    await client.end();
  }
}

void run(createEvent, "não foi possível criar o evento");
