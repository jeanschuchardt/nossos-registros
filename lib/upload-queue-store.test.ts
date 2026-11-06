import { describe, expect, it } from "vitest";
import { CACHE_MAX_FILE_BYTES, shouldCacheFile } from "./upload-queue-store";

const MB = 1024 ** 2;

describe("shouldCacheFile", () => {
  it("guarda fotos e arquivos de até 100 MB", () => {
    expect(shouldCacheFile(8 * MB, 0, null)).toBe(true);
    expect(shouldCacheFile(CACHE_MAX_FILE_BYTES, 0, null)).toBe(true);
  });
  it("não guarda vídeos grandes", () => {
    expect(shouldCacheFile(CACHE_MAX_FILE_BYTES + 1, 0, null)).toBe(false);
  });
  it("respeita o teto total de 1 GB", () => {
    expect(shouldCacheFile(50 * MB, 1000 * MB, null)).toBe(false);
    expect(shouldCacheFile(20 * MB, 1000 * MB, null)).toBe(true);
  });
  it("usa no máximo metade do espaço livre informado pelo navegador", () => {
    expect(shouldCacheFile(60 * MB, 0, 100 * MB)).toBe(false);
    expect(shouldCacheFile(40 * MB, 0, 100 * MB)).toBe(true);
  });
  it("ignora arquivos vazios", () => {
    expect(shouldCacheFile(0, 0, null)).toBe(false);
  });
});
