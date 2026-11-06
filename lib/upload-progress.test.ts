import { describe, expect, it } from "vitest";
import { confirmedOffsetFromRange, ProgressReporter, type ProgressState } from "./upload-progress";

describe("confirmedOffsetFromRange", () => {
  it("avança para o byte seguinte ao confirmado", () => {
    expect(confirmedOffsetFromRange("bytes=0-16777215")).toBe(16_777_216);
  });
  it("volta a zero quando o Drive não informa Range", () => {
    expect(confirmedOffsetFromRange(null)).toBe(0);
    expect(confirmedOffsetFromRange("")).toBe(0);
  });
});

describe("ProgressReporter", () => {
  function setup() {
    let now = 0;
    const sent: Array<[number, ProgressState]> = [];
    const reporter = new ProgressReporter((bytes, state) => sent.push([bytes, state]), 30_000, () => now);
    return { sent, reporter, advance: (ms: number) => { now += ms; } };
  }

  it("limita o progresso normal a um envio por intervalo", () => {
    const { sent, reporter, advance } = setup();
    reporter.report(1, "uploading");
    advance(10_000); reporter.report(2, "uploading");
    advance(25_000); reporter.report(3, "uploading");
    expect(sent).toEqual([[1, "uploading"], [3, "uploading"]]);
  });
  it("envia mudanças de estado imediatamente", () => {
    const { sent, reporter, advance } = setup();
    reporter.report(1, "uploading");
    advance(1); reporter.report(1, "retry_pending");
    advance(1); reporter.report(5, "uploading");
    expect(sent.map(([, state]) => state)).toEqual(["uploading", "retry_pending", "uploading"]);
  });
});
