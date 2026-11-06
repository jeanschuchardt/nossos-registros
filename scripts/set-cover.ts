import { databaseClient, parseArgs, run, UsageError } from "./lib/cli";
import { saveCover } from "./lib/cover";

const USAGE = `Uso:
  npm run db:set-cover -- --slug <slug> --image caminho/para/foto.jpg
  npm run db:set-cover -- --slug <slug> --remove      volta para a capa padrão`;

const args = parseArgs();

async function setCover(): Promise<void> {
  const slug = args.get("slug");
  const image = args.get("image");
  const remove = args.has("remove");
  if (!slug || (!image && !remove) || (image && remove)) throw new UsageError(USAGE);

  const client = databaseClient("nossos-registros-set-cover");
  await client.connect();
  try {
    const event = (await client.query<{ id: string }>("SELECT id FROM events WHERE slug = $1", [slug])).rows[0];
    if (!event) throw new UsageError(`evento ${slug} não encontrado.`);
    if (remove) {
      await client.query("DELETE FROM event_covers WHERE event_id = $1", [event.id]);
      console.log(`OK: ${slug} voltou para a capa padrão.`);
      return;
    }
    const summary = await saveCover(client, event.id, image!);
    console.log(`OK: capa de ${slug} atualizada (${summary}; metadados e localização removidos).`);
  } finally {
    await client.end();
  }
}

void run(setCover, "não foi possível definir a capa");
