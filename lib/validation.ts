const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime"
} as const;

export const ACCEPTED_FILE_TYPES = Object.values(MIME_BY_EXTENSION);
export const ACCEPT_ATTRIBUTE = Object.keys(MIME_BY_EXTENSION).join(",");

export interface FileMetadata {
  filename: string;
  mimeType: string;
  size: number;
}

function extensionOf(filename: string): keyof typeof MIME_BY_EXTENSION | undefined {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  const extension = match?.[0] as keyof typeof MIME_BY_EXTENSION | undefined;
  return extension && extension in MIME_BY_EXTENSION ? extension : undefined;
}

export function maxFileSizeBytes(): number {
  const configured = Number(process.env.MAX_FILE_SIZE_GB);
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new Error("MAX_FILE_SIZE_GB deve ser um número positivo.");
  }
  return configured * 1024 ** 3;
}

export function validateFileMetadata(value: unknown):
  | { ok: true; value: FileMetadata }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Dados inválidos." };
  const input = value as Record<string, unknown>;
  const filename = typeof input.filename === "string" ? input.filename.trim() : "";
  const mimeType = typeof input.mimeType === "string" ? input.mimeType.toLowerCase().trim() : "";
  const size = input.size;
  const extension = extensionOf(filename);

  if (!filename || filename.length > 255 || !extension) {
    return { ok: false, error: "Nome ou extensão de arquivo não permitida." };
  }
  if (!Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > maxFileSizeBytes()) {
    return { ok: false, error: "Tamanho de arquivo inválido ou acima do limite." };
  }
  const expectedMime = MIME_BY_EXTENSION[extension];
  // iOS/Safari may omit MIME for HEIC/MOV. Normalize only known extensions.
  if (mimeType && mimeType !== expectedMime) {
    return { ok: false, error: "O tipo MIME não corresponde à extensão." };
  }
  return { ok: true, value: { filename, mimeType: expectedMime, size: size as number } };
}
