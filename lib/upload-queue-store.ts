import type { UploadEntry } from "@/types/upload";

const DATABASE_NAME = "nossos-registros";
const STORE_NAME = "upload-queue";
const VERSION = 1;

interface StoredUpload {
  id: string;
  eventSlug: string;
  filename: string;
  size: number;
  mimeType: string;
  lastModified: number;
  createdAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("eventSlug", "eventSlug");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function rememberUpload(entry: UploadEntry, eventSlug: string): Promise<void> {
  const stored: StoredUpload = {
    id: entry.id,
    eventSlug,
    filename: entry.filename,
    size: entry.size,
    mimeType: entry.mimeType,
    lastModified: entry.lastModified,
    createdAt: Date.now()
  };
  await transaction("readwrite", (store) => store.put(stored));
}

export async function forgetUpload(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
}

export async function restoreUploads(eventSlug: string): Promise<StoredUpload[]> {
  const records = await transaction<StoredUpload[]>("readonly", (store) => store.getAll());
  return records.filter((record) => record.eventSlug === eventSlug).sort((a, b) => a.createdAt - b.createdAt);
}
