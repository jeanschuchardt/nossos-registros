import { databaseClient, parseArgs, run, UsageError } from "./lib/cli";
import { assertDriveFolder, googleAccessToken } from "./lib/google";

const args = parseArgs();

async function checkGoogle(): Promise<void> {
  const slug = args.get("slug");
  if (!slug) throw new UsageError("Use --slug <slug-do-evento>.");

  const client = databaseClient("nossos-registros-check-google");
  await client.connect();
  let folderId: string | undefined;
  try {
    const result = await client.query<{ drive_folder_id: string }>("SELECT drive_folder_id FROM events WHERE slug = $1", [slug]);
    folderId = result.rows[0]?.drive_folder_id;
  } finally {
    await client.end();
  }
  if (!folderId) throw new UsageError(`evento ${slug} não encontrado.`);

  const accessToken = await googleAccessToken();
  console.log("OK: refresh token válido; access token renovado.");
  const folderName = await assertDriveFolder(accessToken, folderId);
  console.log(`OK: pasta do Drive acessível (${folderName}).`);
}

void run(checkGoogle, "falha ao acessar o Google");
