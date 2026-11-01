import { describe, expect, it } from "vitest";
import { eventAvailability } from "./event-availability";

const now = new Date("2026-11-01T12:00:00Z");

describe("eventAvailability", () => {
  it("libera evento ativo dentro da janela", () => {
    expect(eventAvailability({ status: "active", uploadStartsAt: null, uploadEndsAt: null }, now)).toBe("available");
  });

  it("mantém rascunhos indisponíveis", () => {
    expect(eventAvailability({ status: "draft", uploadStartsAt: null, uploadEndsAt: null }, now)).toBe("draft");
  });

  it("respeita início e fim da janela", () => {
    expect(eventAvailability({ status: "active", uploadStartsAt: new Date("2026-11-02T00:00:00Z"), uploadEndsAt: null }, now)).toBe("not_started");
    expect(eventAvailability({ status: "active", uploadStartsAt: null, uploadEndsAt: new Date("2026-10-31T00:00:00Z") }, now)).toBe("ended");
  });
});
