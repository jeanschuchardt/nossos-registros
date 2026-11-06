import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRecord } from "./events";

const testDatabase = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof import("../test/pglite").createTestDatabase>> | null }));

vi.mock("@/lib/db", async () => {
  const { createTestDatabase } = await import("../test/pglite");
  testDatabase.current = await createTestDatabase();
  return { database: testDatabase.current.pool, readQuery: testDatabase.current.query };
});

const {
  EventCapacityExceededError,
  markAwaitingConfirmation,
  prepareUpload,
  saveUploadSession,
  UploadConflictError,
  UploadPreparationPendingError
} = await import("./uploads");

const db = () => testDatabase.current!;

async function createEvent(capacityBytes = 100): Promise<EventRecord> {
  const slug = `evento-${randomUUID().slice(0, 8)}`;
  const { rows } = await db().query(`
    INSERT INTO events (slug, name, status, drive_folder_id, capacity_bytes, max_file_size_bytes)
    VALUES ($1, 'Teste', 'active', $2, $3, $3)
    RETURNING id, access_token
  `, [slug, `pasta-${slug}`, capacityBytes]);
  const row = rows[0] as { id: string; access_token: string };
  return {
    id: row.id, slug, name: "Teste", status: "active", driveFolderId: `pasta-${slug}`, accessToken: row.access_token,
    eventDate: null, coverVersion: null, uploadStartsAt: null, uploadEndsAt: null, capacityBytes, maxFileSizeBytes: capacityBytes
  };
}

const file = (size: number, filename = "video.mp4") => ({ filename, mimeType: "video/mp4", size });

async function statusOf(uploadId: string): Promise<string> {
  const { rows } = await db().query("SELECT status FROM uploads WHERE id = $1", [uploadId]);
  return (rows[0] as { status: string }).status;
}

/** Simula um upload sem atividade há `hours` horas (o trigger normalmente renova updated_at). */
async function age(uploadId: string, hours: number): Promise<void> {
  await db().db.exec("ALTER TABLE uploads DISABLE TRIGGER uploads_set_updated_at");
  await db().query(`UPDATE uploads SET updated_at = now() - make_interval(hours => $2) WHERE id = $1`, [uploadId, hours]);
  await db().db.exec("ALTER TABLE uploads ENABLE TRIGGER uploads_set_updated_at");
}

async function startSession(event: EventRecord, size: number, key = randomUUID()): Promise<{ uploadId: string; key: string }> {
  const prepared = await prepareUpload(event, file(size), key, "cliente");
  expect(prepared.kind).toBe("create_session");
  await saveUploadSession(prepared.uploadId, "https://www.googleapis.com/upload/sessao", `drive-${key}.mp4`);
  return { uploadId: prepared.uploadId, key };
}

beforeAll(() => { process.env.UPLOAD_SESSION_ENCRYPTION_KEY = "k".repeat(40); });
beforeEach(() => { delete process.env.UPLOAD_ABANDONED_TIMEOUT_MS; });

describe("prepareUpload", { timeout: 30_000 }, () => {
  it("cria, bloqueia preparação concorrente e retoma a sessão salva", async () => {
    const event = await createEvent();
    const key = randomUUID();
    const first = await prepareUpload(event, file(10), key, "cliente");
    expect(first.kind).toBe("create_session");
    await expect(prepareUpload(event, file(10), key, "cliente")).rejects.toBeInstanceOf(UploadPreparationPendingError);

    await saveUploadSession(first.uploadId, "https://www.googleapis.com/upload/sessao", "drive.mp4");
    const resumed = await prepareUpload(event, file(10), key, "cliente");
    expect(resumed).toMatchObject({ kind: "resume", uploadId: first.uploadId, sessionUrl: "https://www.googleapis.com/upload/sessao" });
  });

  it("recusa a mesma chave para outro arquivo", async () => {
    const event = await createEvent();
    const key = randomUUID();
    await prepareUpload(event, file(10), key, "cliente");
    await expect(prepareUpload(event, file(11), key, "cliente")).rejects.toBeInstanceOf(UploadConflictError);
  });

  it("isola chaves de idempotência por evento", async () => {
    const [a, b] = [await createEvent(), await createEvent()];
    const key = randomUUID();
    const first = await prepareUpload(a, file(10), key, "cliente");
    const second = await prepareUpload(b, file(10), key, "cliente");
    expect(first.uploadId).not.toBe(second.uploadId);
  });

  it("recusa com erro de capacidade quando o evento lota", async () => {
    const event = await createEvent(100);
    await startSession(event, 60);
    await expect(prepareUpload(event, file(60), randomUUID(), "cliente")).rejects.toBeInstanceOf(EventCapacityExceededError);
  });

  it("libera a reserva de uploads abandonados", async () => {
    const event = await createEvent(100);
    const abandoned = await startSession(event, 60);
    await age(abandoned.uploadId, 3);

    const next = await prepareUpload(event, file(60), randomUUID(), "cliente");
    expect(next.kind).toBe("create_session");
    expect(await statusOf(abandoned.uploadId)).toBe("expired");
  });

  it("não expira uploads com atividade recente", async () => {
    const event = await createEvent(100);
    const active = await startSession(event, 60);
    await age(active.uploadId, 1);
    await expect(prepareUpload(event, file(60), randomUUID(), "cliente")).rejects.toBeInstanceOf(EventCapacityExceededError);
    expect(await statusOf(active.uploadId)).toBe("session_created");
  });

  it("retoma um upload expirado com a mesma sessão se ainda houver espaço", async () => {
    const event = await createEvent(100);
    const abandoned = await startSession(event, 60);
    await age(abandoned.uploadId, 3);
    await prepareUpload(event, file(10, "foto.mp4"), randomUUID(), "cliente");

    const resumed = await prepareUpload(event, file(60), abandoned.key, "cliente");
    expect(resumed).toMatchObject({ kind: "resume", uploadId: abandoned.uploadId });
    expect(await statusOf(abandoned.uploadId)).toBe("session_created");
  });

  it("não deixa um upload expirado voltar se o evento lotou", async () => {
    const event = await createEvent(100);
    const abandoned = await startSession(event, 60);
    await age(abandoned.uploadId, 3);
    await startSession(event, 60);

    await expect(prepareUpload(event, file(60), abandoned.key, "cliente")).rejects.toBeInstanceOf(EventCapacityExceededError);
    expect(await markAwaitingConfirmation(abandoned.uploadId)).toBe(false);
    expect(await statusOf(abandoned.uploadId)).toBe("expired");
  });

  it("recria preparação travada além do timeout", async () => {
    const event = await createEvent();
    const key = randomUUID();
    const first = await prepareUpload(event, file(10), key, "cliente");
    await age(first.uploadId, 1);
    const again = await prepareUpload(event, file(10), key, "cliente");
    expect(again).toMatchObject({ kind: "create_session", uploadId: first.uploadId });
  });
});
