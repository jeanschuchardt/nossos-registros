export function isPreparationStale(updatedAt: Date, now: Date, timeoutMs: number): boolean {
  return now.getTime() - updatedAt.getTime() >= timeoutMs;
}

export function isSessionUsable(expiresAt: Date | null, now: Date): boolean {
  return expiresAt === null || expiresAt > now;
}

export interface FileIdentity {
  filename: string;
  size: number;
  lastModified: number;
}

export function matchesOriginalFile(identity: FileIdentity, file: File): boolean {
  return identity.filename === file.name
    && identity.size === file.size
    && identity.lastModified === file.lastModified;
}
