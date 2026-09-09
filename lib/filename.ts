import { randomUUID } from "node:crypto";

const MAX_BASE_LENGTH = 120;

export function sanitizeFilename(filename: string): string {
  const leaf = filename.replace(/\\/g, "/").split("/").pop() ?? "arquivo";
  const normalized = leaf.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+/, "")
    .slice(0, MAX_BASE_LENGTH);
  return safe || "arquivo";
}

export function buildDriveFilename(filename: string, now = new Date()): string {
  const safe = sanitizeFilename(filename);
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot).toLowerCase() : "";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  return `${stamp}_${randomUUID()}_${base}${extension}`;
}
