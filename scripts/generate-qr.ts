import { mkdir } from "node:fs/promises";
import QRCode from "qrcode";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
if (!baseUrl) throw new Error("Defina NEXT_PUBLIC_SITE_URL.");
const slugIndex = process.argv.indexOf("--slug");
const slug = slugIndex >= 0 ? process.argv[slugIndex + 1] : undefined;
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Use --slug <slug-do-evento>.");
const url = new URL(`/e/${slug}`, baseUrl);
await mkdir("public", { recursive: true });
await QRCode.toFile("public/event-qr.png", url.toString(), { width: 1200, margin: 4, errorCorrectionLevel: "H", color: { dark: "#292622", light: "#FFFDF9" } });
console.log(`QR Code criado em public/event-qr.png para ${url.toString()}`);
