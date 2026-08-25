import { describe, expect, it } from "vitest";

import { TYPING_MS_MAX, TYPING_MS_MIN, typingDelayMs } from "./typing";

describe("typingDelayMs", () => {
  it("não mostra presença para corpo vazio ou só espaço", () => {
    expect(typingDelayMs("")).toBe(0);
    expect(typingDelayMs("   \n ")).toBe(0);
  });

  it("aplica o piso em texto curto", () => {
    // "oi" = 2 chars * 25ms = 50ms, bem abaixo do piso.
    expect(typingDelayMs("oi")).toBe(TYPING_MS_MIN);
  });

  it("aplica o teto em texto longo", () => {
    expect(typingDelayMs("a".repeat(500))).toBe(TYPING_MS_MAX);
  });

  it("escala com o tamanho entre piso e teto", () => {
    const curto = typingDelayMs("a".repeat(40));
    const longo = typingDelayMs("a".repeat(80));
    expect(curto).toBeGreaterThan(TYPING_MS_MIN);
    expect(longo).toBeGreaterThan(curto);
    expect(longo).toBeLessThanOrEqual(TYPING_MS_MAX);
  });
});
