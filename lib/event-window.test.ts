import { describe, expect, it } from "vitest";
import { parseEventDate, uploadWindowFor } from "./event-window";
import { eventAvailability } from "./event-availability";

describe("uploadWindowFor", () => {
  const window = uploadWindowFor("2026-11-21");

  it("abre às 00:00 de Brasília do dia anterior", () => {
    expect(window.startsAt.toISOString()).toBe("2026-11-20T03:00:00.000Z");
  });
  it("fecha ao fim do 7º dia após o evento", () => {
    expect(window.endsAt.toISOString()).toBe("2026-11-29T03:00:00.000Z");
  });
  it("integra com a disponibilidade do evento", () => {
    const event = { status: "active" as const, uploadStartsAt: window.startsAt, uploadEndsAt: window.endsAt };
    expect(eventAvailability(event, new Date("2026-11-20T02:59:00Z"))).toBe("not_started");
    expect(eventAvailability(event, new Date("2026-11-28T23:00:00-03:00"))).toBe("available");
    expect(eventAvailability(event, new Date("2026-11-29T00:00:00-03:00"))).toBe("ended");
  });
  it("rejeita datas inválidas", () => {
    expect(() => parseEventDate("2026-02-30")).toThrow();
    expect(() => parseEventDate("21/11/2026")).toThrow();
  });
});
