import { beforeEach, describe, expect, it } from "vitest";
import { validateFileMetadata } from "./validation";

describe("validateFileMetadata", () => {
  beforeEach(() => { process.env.MAX_FILE_SIZE_GB = "10"; });
  it("aceita HEIC sem MIME enviado pelo Safari", () => expect(validateFileMetadata({ filename: "IMG_1.HEIC", mimeType: "", size: 10 })).toMatchObject({ ok: true }));
  it("rejeita extensão executável", () => expect(validateFileMetadata({ filename: "foto.exe", mimeType: "image/jpeg", size: 10 })).toMatchObject({ ok: false }));
  it("rejeita MIME incompatível", () => expect(validateFileMetadata({ filename: "foto.jpg", mimeType: "video/mp4", size: 10 })).toMatchObject({ ok: false }));
  it("aceita vídeos de vários GB dentro do padrão operacional", () => expect(validateFileMetadata({ filename: "4k.mp4", mimeType: "video/mp4", size: 8 * 1024 ** 3 })).toMatchObject({ ok: true }));
  it("aplica o limite configurável em GB", () => { process.env.MAX_FILE_SIZE_GB = "5"; expect(validateFileMetadata({ filename: "v.mp4", mimeType: "video/mp4", size: 6 * 1024 ** 3 })).toMatchObject({ ok: false }); });
});
