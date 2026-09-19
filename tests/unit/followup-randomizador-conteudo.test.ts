import { describe, expect, it } from "vitest";

import { flowGraphSchema, type FlowGraph } from "@/lib/followup/graph-schema";
import { escolherCaminho, processNode, type EnrollmentRow } from "@/lib/followup/node-handlers";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { personalizarTexto } from "@/lib/agent-engine/agent/followup-turn";

const pos = { x: 0, y: 0 };
const caminhos = [
  { id: "a", label: "A", weight: 50 },
  { id: "b", label: "B", weight: 30 },
  { id: "c", label: "C", weight: 20 },
];

const grafo: FlowGraph = flowGraphSchema.parse({
  nodes: [
    { id: "t", type: "trigger", label: "Gatilho", position: pos, config: {} },
    { id: "r", type: "randomizer", label: "Sorteio", position: pos, config: { branches: caminhos } },
    ...["a", "b", "c"].map((id) => ({
      id: `c${id}`,
      type: "content",
      label: `Conteúdo ${id}`,
      position: pos,
      config: { items: [{ kind: "typing", seconds: 3 }, { kind: "text", text: `Oi {{primeiro_nome}}, versão ${id}` }] },
    })),
    { id: "e", type: "end", label: "Fim", position: pos, config: { outcome: "exhausted" } },
  ],
  edges: [
    { id: "1", source: "t", target: "r", condition: { type: "always" } },
    { id: "2", source: "r", target: "ca", condition: { type: "branch", branch_id: "a" } },
    { id: "3", source: "r", target: "cb", condition: { type: "branch", branch_id: "b" } },
    { id: "4", source: "r", target: "cc", condition: { type: "branch", branch_id: "c" } },
    { id: "5", source: "ca", target: "e", condition: { type: "always" } },
    { id: "6", source: "cb", target: "e", condition: { type: "always" } },
    { id: "7", source: "cc", target: "e", condition: { type: "always" } },
  ],
});

const enrollment = (id: string, node: string): EnrollmentRow => ({
  id,
  organization_id: "org",
  pointer_id: "p",
  version_id: "v",
  contact_id: "k",
  conversation_id: null,
  current_node_id: node,
  status: "active",
  next_eval_at: null,
  claimed_until: null,
  attempts: 0,
  max_attempts: 5,
  last_error: null,
  steps_taken: 1,
  outcome: null,
  cancel_reason: null,
  started_at: "2026-09-19T00:00:00Z",
  completed_at: null,
  updated_at: "2026-09-19T00:00:00Z",
});
const lead = { lead_stage: null, tags: [], steps_taken: 1, last_outcome: null };
const clock = () => new Date("2026-09-19T12:00:00Z");
const no = (id: string) => grafo.nodes.find((n) => n.id === id)!;

describe("Randomizador", () => {
  it("o mesmo lead cai SEMPRE no mesmo caminho — reprocessar não troca a versão", () => {
    const um = escolherCaminho(caminhos, "enr-1:r");
    for (let i = 0; i < 5; i++) expect(escolherCaminho(caminhos, "enr-1:r")).toBe(um);
  });

  it("distribui perto dos pesos", () => {
    const conta: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 3000; i++) conta[escolherCaminho(caminhos, `enr-${i}:r`)]! += 1;
    expect(conta.a! / 3000).toBeGreaterThan(0.44);
    expect(conta.a! / 3000).toBeLessThan(0.56);
    expect(conta.c! / 3000).toBeGreaterThan(0.15);
    expect(conta.c! / 3000).toBeLessThan(0.25);
  });

  it("avança pelo caminho sorteado", () => {
    const r = processNode({ node: no("r"), edges: grafo.edges, enrollment: enrollment("enr-1", "r"), lead, clock });
    const esperado = `c${escolherCaminho(caminhos, "enr-1:r")}`;
    expect(r).toMatchObject({ kind: "advance", next_node_id: esperado });
  });

  it("pesos que não somam 100 não passam no esquema", () => {
    const ruim = { branches: [{ id: "a", label: "A", weight: 50 }, { id: "b", label: "B", weight: 40 }] };
    expect(() =>
      flowGraphSchema.parse({
        nodes: [
          { id: "t", type: "trigger", label: "G", position: pos, config: {} },
          { id: "r", type: "randomizer", label: "R", position: pos, config: ruim },
        ],
        edges: [],
      }),
    ).toThrow(/100%/);
  });

  it("publicação barra caminho sorteável solto", () => {
    const solto = { ...grafo, edges: grafo.edges.filter((e) => e.id !== "4") };
    const r = validateFlowForPublish(solto);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.node_id === "r" && e.branch_id === "c")).toBe(true);
    expect(validateFlowForPublish(grafo)).toEqual({ ok: true });
  });
});

describe("Conteúdo", () => {
  it("1ª entrada enfileira UM turno de envio, como a Ação", () => {
    const r = processNode({ node: no("ca"), edges: grafo.edges, enrollment: enrollment("e", "ca"), lead, clock });
    expect(r).toEqual({ kind: "enqueue_turn", purpose: "send_message", wake_status: "active" });
  });

  it("com o turno em voo, só rechecha — nunca reenfileira (anti-duplicação)", () => {
    const r = processNode({
      node: no("ca"),
      edges: grafo.edges,
      enrollment: enrollment("e", "ca"),
      lead,
      clock,
      actionEnqueued: true,
      actionRecheckCount: 1,
    });
    expect(r.kind).toBe("recheck");
  });

  it("bloco só com 'digitando' não passa no esquema", () => {
    expect(() =>
      flowGraphSchema.parse({
        nodes: [
          { id: "t", type: "trigger", label: "G", position: pos, config: {} },
          { id: "c", type: "content", label: "C", position: pos, config: { items: [{ kind: "typing", seconds: 2 }] } },
        ],
        edges: [],
      }),
    ).toThrow(/texto ou uma mídia/);
  });
});

describe("personalizarTexto — nome do cliente em mensagem automática", () => {
  it("troca pelo primeiro nome", () => {
    expect(personalizarTexto("Oi {{primeiro_nome}}! Chegaram Androids", "Ana Flávia")).toBe("Oi Ana! Chegaram Androids");
  });

  it("sem nome, a variável sai da frase — nunca chega {{primeiro_nome}} ao cliente", () => {
    expect(personalizarTexto("Oi {{primeiro_nome}}! Chegaram Androids", null)).toBe("Oi! Chegaram Androids");
    expect(personalizarTexto("{{primeiro_nome}}, lembrei de você", null)).toBe("Lembrei de você");
  });

  it("identificador técnico não é nome", () => {
    expect(personalizarTexto("Oi {{primeiro_nome}}!", "5581999999999")).toBe("Oi!");
  });

  it("texto sem variável sai intacto", () => {
    expect(personalizarTexto("kkk combinado", "Ana")).toBe("kkk combinado");
  });
});
