import { describe, expect, it } from "vitest";
import { buildDriveFilename, sanitizeFilename } from "./filename";

describe("nomes no Google Drive", () => {
  it("remove caminhos e caracteres perigosos", () => {
    expect(sanitizeFilename("../../Fóto do casal.JPG")).toBe("Foto_do_casal.JPG");
  });

  it("gera nomes únicos preservando a extensão", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const first = buildDriveFilename("foto.JPG", now);
    const second = buildDriveFilename("foto.JPG", now);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^20261101_120000_[0-9a-f-]+_foto\.jpg$/);
  });
});
