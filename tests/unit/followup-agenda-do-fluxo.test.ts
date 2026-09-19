import { describe, expect, it } from "vitest";

import { agendaDoFluxo, quemEscreve } from "@/lib/followup/agenda-do-fluxo";

const H = 3_600_000;
const sempre = { type: "always" };

/** O fluxo "Sumiu depois do preço": trigger -> msg -> 21h -> msg -> 48h -> msg -> fim. */
function fluxoLinear(esperaDois: object = { mode: "fixed", duration_ms: 48 * H }) {
  return {
    nodes: [
      { id: "t", type: "trigger", config: {} },
      { id: "a1", type: "action", config: { mode: "ai_message", prompt_hint: "1" } },
      { id: "w1", type: "wait", config: { mode: "fixed", duration_ms: 21 * H } },
      { id: "a2", type: "action", config: { mode: "ai_message", prompt_hint: "2" } },
      { id: "w2", type: "wait", config: esperaDois },
      { id: "a3", type: "action", config: { mode: "template" } },
      { id: "fim", type: "end", config: { outcome: "exhausted" } },
    ],
    edges: [
      { id: "e1", source: "t", target: "a1", condition: sempre },
      { id: "e2", source: "a1", target: "w1", condition: sempre },
      { id: "e3", source: "w1", target: "a2", condition: sempre },
      { id: "e4", source: "a2", target: "w2", condition: sempre },
      { id: "e5", source: "w2", target: "a3", condition: sempre },
      { id: "e6", source: "a3", target: "fim", condition: sempre },
    ],
  } as never;
}

describe("agendaDoFluxo", () => {
  it("soma as esperas fixas: agora, 21h e 69h", () => {
    expect(agendaDoFluxo(fluxoLinear())).toEqual([
      { aposMs: 0, modo: "ai_message" },
      { aposMs: 21 * H, modo: "ai_message" },
      { aposMs: 69 * H, modo: "template" },
    ]);
  });

  it("espera smart deixa o horário dos envios seguintes desconhecido", () => {
    const agenda = agendaDoFluxo(fluxoLinear({ mode: "smart", min_ms: H, max_ms: 72 * H }));
    expect(agenda.map((e) => e.aposMs)).toEqual([0, 21 * H, null]);
  });

  it("não entra em loop num grafo com ciclo", () => {
    const g = fluxoLinear() as unknown as { edges: object[] };
    g.edges.push({ id: "volta", source: "fim", target: "t", condition: sempre });
    expect(agendaDoFluxo(g as never)).toHaveLength(3);
  });
});

describe("quemEscreve — o que a janela do Inbox promete", () => {
  it("só Conteúdo = texto pronto; só Ação = IA; os dois = misto; nada = null", () => {
    expect(quemEscreve([{ aposMs: 0, modo: "content" }])).toBe("pronto");
    expect(quemEscreve([{ aposMs: 0, modo: "ai_message" }, { aposMs: 1, modo: "template" }])).toBe("ia");
    expect(quemEscreve([{ aposMs: 0, modo: "content" }, { aposMs: 1, modo: "ai_message" }])).toBe("misto");
    expect(quemEscreve([])).toBeNull();
  });
});
