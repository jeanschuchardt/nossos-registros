import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function masterSecret(): string {
  const secret = process.env.UPLOAD_SESSION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("Configure UPLOAD_SESSION_ENCRYPTION_KEY com pelo menos 32 caracteres.");
  }
  return secret;
}

// Chaves derivadas por finalidade: a mesma variável nunca é usada para duas coisas.
function derivedKey(purpose: "session-url" | "upload-token"): Buffer {
  const secret = masterSecret();
  // Mantém compatibilidade com sessões cifradas antes da derivação por finalidade.
  if (purpose === "session-url") return createHash("sha256").update(secret).digest();
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function encryptSessionUrl(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("session-url"), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSessionUrl(value: string): string {
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Sessão de upload inválida.");
  const decipher = createDecipheriv("aes-256-gcm", derivedKey("session-url"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function safeEqual(a: string, b: string): boolean {
  // Compara digests de tamanho fixo para não vazar o comprimento nem o conteúdo.
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}

/** Credencial que o navegador recebe na criação e reapresenta em progress/confirm. */
export function uploadToken(uploadId: string): string {
  return createHmac("sha256", derivedKey("upload-token")).update(`upload:${uploadId}`).digest("base64url");
}

export function isValidUploadToken(token: string | null, uploadId: string): boolean {
  return Boolean(token) && safeEqual(token!, uploadToken(uploadId));
}
