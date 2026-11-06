import type { UploadEntry } from "@/types/upload";

const DATABASE_NAME = "nossos-registros";
const QUEUE_STORE = "upload-queue";
// Cópias dos arquivos pequenos, para retomar sem pedir que o convidado selecione de novo.
const FILE_STORE = "upload-files";
const VERSION = 2;

// Sessões resumíveis do Drive duram cerca de uma semana; depois disso não há o que retomar.
const MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;

export const CACHE_MAX_FILE_BYTES = 100 * 1024 ** 2;
const CACHE_MAX_TOTAL_BYTES = 1024 ** 3;

interface StoredUpload {
  id: string;
  eventSlug: string;
  filename: string;
  size: number;
  mimeType: string;
  lastModified: number;
  createdAt: number;
  /** Tamanho da cópia guardada em FILE_STORE; 0 quando não há cópia. */
  cachedBytes?: number;
}

export interface RestoredUpload extends StoredUpload {
  file?: File;
}

/**
 * Decide se uma cópia cabe: arquivos de até 100 MB, até 1 GB no total e sem
 * passar de metade do espaço que o navegador ainda oferece. Vídeos grandes
 * ficam de fora porque duplicariam vários GB no aparelho, e o Safari do
 * iPhone limita e pode apagar esse armazenamento.
 */
export function shouldCacheFile(size: number, alreadyCachedBytes: number, availableBytes: number | null): boolean {
  if (size <= 0 || size > CACHE_MAX_FILE_BYTES) return false;
  if (alreadyCachedBytes + size > CACHE_MAX_TOTAL_BYTES) return false;
  return availableBytes === null || size <= availableBytes / 2;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: "id" }).createIndex("eventSlug", "eventSlug");
      }
      if (!database.objectStoreNames.contains(FILE_STORE)) database.createObjectStore(FILE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStores<T>(mode: IDBTransactionMode, run: (queue: IDBObjectStore, files: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([QUEUE_STORE, FILE_STORE], mode);
    // Escuta a conclusão antes de enfileirar as operações, para não perder o evento.
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const [result] = await Promise.all([run(transaction.objectStore(QUEUE_STORE), transaction.objectStore(FILE_STORE)), done]);
    return result;
  } finally {
    database.close();
  }
}

async function availableStorageBytes(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) return null;
    return Math.max(0, estimate.quota - (estimate.usage ?? 0));
  } catch {
    return null;
  }
}

let persistenceRequested = false;
function requestPersistence(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  // Pede ao navegador para não apagar o armazenamento sob pressão de espaço. Melhor esforço.
  void navigator.storage?.persist?.().catch(() => false);
}

/** Registra o envio e, se couber, guarda uma cópia do arquivo. Nunca bloqueia nem falha o upload. */
const remembered = new Set<string>();

export async function rememberUpload(entry: UploadEntry, eventSlug: string): Promise<void> {
  // Pode ser chamado mais de uma vez para o mesmo envio (updaters do React); grava só uma vez.
  if (remembered.has(entry.id)) return;
  remembered.add(entry.id);
  const stored: StoredUpload = {
    id: entry.id,
    eventSlug,
    filename: entry.filename,
    size: entry.size,
    mimeType: entry.mimeType,
    lastModified: entry.lastModified,
    createdAt: Date.now(),
    cachedBytes: 0
  };
  await withStores("readwrite", async (queue) => { await promisify(queue.put(stored)); });

  if (!entry.file) return;
  const records = await withStores("readonly", (queue) => promisify(queue.getAll() as IDBRequest<StoredUpload[]>));
  const alreadyCached = records.reduce((sum, record) => sum + (record.cachedBytes ?? 0), 0);
  if (!shouldCacheFile(entry.file.size, alreadyCached, await availableStorageBytes())) return;
  requestPersistence();
  try {
    await withStores("readwrite", async (queue, files) => {
      await promisify(files.put(entry.file!, entry.id));
      await promisify(queue.put({ ...stored, cachedBytes: entry.file!.size }));
    });
  } catch {
    // Sem espaço (QuotaExceededError) ou navegador recusou: o envio segue normalmente,
    // e uma retomada pedirá o arquivo de novo.
  }
}

export async function forgetUpload(id: string): Promise<void> {
  await withStores("readwrite", async (queue, files) => {
    await Promise.all([promisify(queue.delete(id)), promisify(files.delete(id))]);
  });
}

function asFile(value: unknown, record: StoredUpload): File | undefined {
  if (!(value instanceof Blob) || value.size !== record.size) return undefined;
  // Alguns navegadores devolvem Blob em vez de File; recompõe nome e data originais.
  return value instanceof File
    ? value
    : new File([value], record.filename, { type: record.mimeType, lastModified: record.lastModified });
}

export async function restoreUploads(eventSlug: string, now = Date.now()): Promise<RestoredUpload[]> {
  const records = await withStores("readonly", (queue) => promisify(queue.getAll() as IDBRequest<StoredUpload[]>));
  const stale = records.filter((record) => now - record.createdAt > MAX_AGE_MS);
  await Promise.all(stale.map((record) => forgetUpload(record.id).catch(() => undefined)));

  const current = records
    .filter((record) => record.eventSlug === eventSlug && now - record.createdAt <= MAX_AGE_MS)
    .sort((a, b) => a.createdAt - b.createdAt);
  return Promise.all(current.map(async (record) => {
    if (!record.cachedBytes) return record;
    try {
      const cached = await withStores("readonly", (_queue, files) => promisify(files.get(record.id)));
      return { ...record, file: asFile(cached, record) };
    } catch {
      return record;
    }
  }));
}
