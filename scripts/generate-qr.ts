import { mkdir } from "node:fs/promises";
import QRCode from "qrcode";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
const token = process.env.EVENT_TOKEN;
if (!baseUrl || !token) throw new Error("Defina NEXT_PUBLIC_SITE_URL e EVENT_TOKEN (ex.: npm run qr -- --help não carrega .env automaticamente; use: npx tsx --env-file=.env.local scripts/generate-qr.ts).");
const url = new URL("/upload", baseUrl);
url.searchParams.set("t", token);
await mkdir("public", { recursive: true });
await QRCode.toFile("public/event-qr.png", url.toString(), { width: 1200, margin: 4, errorCorrectionLevel: "H", color: { dark: "#292622", light: "#FFFDF9" } });
console.log("QR Code criado em public/event-qr.png");
