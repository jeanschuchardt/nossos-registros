import { beforeEach, describe, expect, it } from "vitest";
import { decryptSessionUrl, encryptSessionUrl, isValidUploadToken, safeEqual, uploadToken } from "./session-crypto";

describe("session-crypto", () => {
  beforeEach(() => { process.env.UPLOAD_SESSION_ENCRYPTION_KEY = "k".repeat(40); });

  it("exige chave própria com pelo menos 32 caracteres", () => {
    process.env.UPLOAD_SESSION_ENCRYPTION_KEY = "curta";
    process.env.GOOGLE_CLIENT_SECRET = "y".repeat(40);
    expect(() => encryptSessionUrl("https://example.com")).toThrow(/UPLOAD_SESSION_ENCRYPTION_KEY/);
  });
  it("cifra e decifra a URL da sessão", () => {
    const url = "https://www.googleapis.com/upload/drive/v3/files?upload_id=abc";
    expect(decryptSessionUrl(encryptSessionUrl(url))).toBe(url);
  });
  it("valida o token do upload só para o próprio upload", () => {
    const token = uploadToken("11111111-1111-4111-8111-111111111111");
    expect(isValidUploadToken(token, "11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isValidUploadToken(token, "22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(isValidUploadToken(null, "11111111-1111-4111-8111-111111111111")).toBe(false);
  });
  it("compara strings sem aceitar prefixos", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });
});
