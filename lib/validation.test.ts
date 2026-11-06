import { describe, expect, it } from "vitest";
import { PHOTO_MAX_BYTES, VIDEO_MAX_BYTES, validateFileMetadata } from "./validation";

const MB = 1024 ** 2;

describe("validateFileMetadata", () => {
  it("aceita HEIC sem MIME enviado pelo Safari", () => {
    expect(validateFileMetadata({ filename: "IMG_1.HEIC", mimeType: "", size: 10 })).toMatchObject({ ok: true, value: { mimeType: "image/heic" } });
  });
  it("rejeita extensão executável", () => {
    expect(validateFileMetadata({ filename: "foto.exe", mimeType: "image/jpeg", size: 10 })).toMatchObject({ ok: false });
  });
  it("rejeita áudio e documentos", () => {
    expect(validateFileMetadata({ filename: "audio.m4a", mimeType: "audio/mp4", size: 10 })).toMatchObject({ ok: false });
    expect(validateFileMetadata({ filename: "doc.pdf", mimeType: "application/pdf", size: 10 })).toMatchObject({ ok: false });
  });
  it("rejeita MIME incompatível", () => {
    expect(validateFileMetadata({ filename: "foto.jpg", mimeType: "video/mp4", size: 10 })).toMatchObject({ ok: false });
  });
  it("aceita fotos até 50 MB e recusa acima", () => {
    expect(validateFileMetadata({ filename: "a.jpg", mimeType: "image/jpeg", size: PHOTO_MAX_BYTES })).toMatchObject({ ok: true });
    expect(validateFileMetadata({ filename: "a.jpg", mimeType: "image/jpeg", size: PHOTO_MAX_BYTES + 1 })).toMatchObject({ ok: false, error: "a.jpg: fotos podem ter até 50 MB." });
  });
  it("aceita vídeos até 5 GB e recusa acima", () => {
    expect(validateFileMetadata({ filename: "4k.mov", mimeType: "video/quicktime", size: VIDEO_MAX_BYTES })).toMatchObject({ ok: true });
    expect(validateFileMetadata({ filename: "4k.mp4", mimeType: "video/mp4", size: VIDEO_MAX_BYTES + 1 })).toMatchObject({ ok: false });
  });
  it("aceita M4V com os MIMEs que os navegadores informam", () => {
    expect(validateFileMetadata({ filename: "clip.m4v", mimeType: "video/x-m4v", size: 10 * MB })).toMatchObject({ ok: true, value: { mimeType: "video/x-m4v" } });
    expect(validateFileMetadata({ filename: "clip.M4V", mimeType: "video/mp4", size: 10 * MB })).toMatchObject({ ok: true, value: { mimeType: "video/x-m4v" } });
  });
  it("aplica o limite do evento quando menor que o do tipo", () => {
    expect(validateFileMetadata({ filename: "v.mp4", mimeType: "video/mp4", size: 20 * MB }, 10 * MB)).toMatchObject({ ok: false });
  });
  it("rejeita tamanho vazio ou não inteiro", () => {
    expect(validateFileMetadata({ filename: "a.png", mimeType: "image/png", size: 0 })).toMatchObject({ ok: false });
    expect(validateFileMetadata({ filename: "a.png", mimeType: "image/png", size: 1.5 })).toMatchObject({ ok: false });
  });
});
