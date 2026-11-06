import { describe, expect, it } from "vitest";
import { coverUrl, formatEventDate } from "./event-display";

describe("formatEventDate", () => {
  it("escreve a data por extenso, sem depender de fuso", () => {
    expect(formatEventDate("2026-11-21")).toBe("21 de novembro de 2026");
    expect(formatEventDate("2027-01-01")).toBe("1 de janeiro de 2027");
  });
  it("devolve null sem data ou com formato inválido", () => {
    expect(formatEventDate(null)).toBeNull();
    expect(formatEventDate("21/11/2026")).toBeNull();
  });
});

describe("coverUrl", () => {
  it("inclui o token e a versão da capa", () => {
    expect(coverUrl("casamento-ana", "abc", 1700)).toBe("/e/casamento-ana/cover?k=abc&v=1700");
  });
  it("é null quando o evento usa a capa padrão", () => {
    expect(coverUrl("casamento-ana", "abc", null)).toBeNull();
  });
});
