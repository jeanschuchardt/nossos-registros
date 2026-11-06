import { mkdir } from "node:fs/promises";
import QRCode from "qrcode";
import { databaseClient, eventUrl, parseArgs, run, UsageError } from "./lib/cli";

const args = parseArgs();

async function generateQr(): Promise<void> {
  const slug = args.get("slug");
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new UsageError("Use --slug <slug-do-evento> [--out arquivo.png].");

  const client = databaseClient("nossos-registros-qr");
  await client.connect();
  let accessToken: string | undefined;
  try {
    const result = await client.query<{ access_token: string }>("SELECT access_token FROM events WHERE slug = $1", [slug]);
    accessToken = result.rows[0]?.access_token;
  } finally {
    await client.end();
  }
  if (!accessToken) throw new UsageError(`evento ${slug} não encontrado.`);

  // O token entra no QR: sem ele o link abre "Link inválido".
  const url = eventUrl(slug, accessToken);
  const output = args.get("out") ?? `public/qr-${slug}.png`;
  await mkdir(output.includes("/") ? output.slice(0, output.lastIndexOf("/")) : ".", { recursive: true });
  await QRCode.toFile(output, url, { width: 1200, margin: 4, errorCorrectionLevel: "H", color: { dark: "#292622", light: "#FFFDF9" } });
  console.log(`OK: QR Code criado em ${output}`);
  console.log(`    Link: ${url}`);
}

void run(generateQr, "não foi possível gerar o QR Code");
